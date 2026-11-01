import { isTriggerType } from '../workflow.ts';
import type { DataRoot, EngineRunResult, Json, JsonObject, TraceEntry } from '../types.ts';
import type { Engine, EngineInfo, EngineRunRequest } from './types.ts';

const MAX_ITEMS = 5000;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

class SimError extends Error {
  node: string | undefined;
  constructor(message: string, node?: string) {
    super(message);
    this.node = node;
  }
}

type NodeOut = Json[][];
interface RawNode { name: string; type: string; typeVersion?: number; disabled?: boolean; parameters: JsonObject }
interface Link { from: string; fromIdx: number; to: string }

function asItems(v: Json | undefined): Json[] {
  if (v === undefined) return [{}];
  const list = Array.isArray(v) ? v : [v];
  return list.map((x) => structuredClone(x));
}

function setDot(target: Record<string, Json>, path: string, value: Json): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => FORBIDDEN.has(p))) throw new SimError(`Nome de campo inválido: "${path}".`);
  let cur = target;
  for (const p of parts.slice(0, -1)) {
    const next = Object.hasOwn(cur, p) ? cur[p] : undefined;
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[p] = {};
    cur = cur[p] as Record<string, Json>;
  }
  cur[parts[parts.length - 1] as string] = value;
}

function coerce(raw: Json, type: string, field: string, node: string): Json {
  if (typeof raw === 'string' && raw.startsWith('=')) {
    throw new SimError(`Expressão em "${field}" não é avaliada pelo simulador; forneça um mock para este nó.`, node);
  }
  switch (type) {
    case 'number': {
      const n = Number(raw);
      if (typeof raw === 'boolean' || raw === '' || !Number.isFinite(n)) throw new SimError(`Valor numérico inválido em "${field}".`, node);
      return n;
    }
    case 'boolean':
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') return false;
      throw new SimError(`Valor booleano inválido em "${field}".`, node);
    case 'object':
    case 'array':
      if (typeof raw !== 'string') return raw;
      try { return JSON.parse(raw) as Json; } catch { throw new SimError(`JSON inválido em "${field}".`, node); }
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

function applySet(node: RawNode, items: Json[]): Json[] {
  const p = node.parameters;
  const assigns: { name: string; value: Json; type: string }[] = [];
  let keepOthers = true;
  const a3 = (p.assignments as { assignments?: Json[] } | undefined)?.assignments;
  if (Array.isArray(a3)) {
    if (p.mode === 'raw') throw new SimError('Set em modo "raw" não é suportado pelo simulador; use um mock.', node.name);
    keepOthers = p.includeOtherFields === true;
    for (const a of a3 as Record<string, Json>[]) {
      assigns.push({ name: String(a.name), value: a.value as Json, type: String(a.type ?? 'string') });
    }
  } else if (p.values && typeof p.values === 'object' && !Array.isArray(p.values)) {
    const opts = (p.options ?? {}) as Record<string, Json>;
    keepOthers = !(p.keepOnlySet === true || opts.keepOnlySet === true);
    for (const [t, list] of Object.entries(p.values as Record<string, Json>)) {
      if (!Array.isArray(list)) continue;
      for (const a of list as Record<string, Json>[]) assigns.push({ name: String(a.name), value: a.value as Json, type: t });
    }
  } else {
    throw new SimError('Configuração do nó Set não reconhecida; use um mock.', node.name);
  }
  return items.map((item) => {
    const base = keepOthers && item !== null && typeof item === 'object' && !Array.isArray(item) ? structuredClone(item) : {};
    for (const a of assigns) setDot(base as Record<string, Json>, a.name, coerce(a.value, a.type, a.name, node.name));
    return base;
  });
}

function buildGraph(workflow: JsonObject) {
  const nodes = new Map<string, RawNode>();
  for (const n of workflow.nodes as Record<string, Json>[]) {
    const type = String(n.type);
    if (type.endsWith('.stickyNote')) continue;
    nodes.set(String(n.name), {
      name: String(n.name), type, disabled: n.disabled === true,
      typeVersion: typeof n.typeVersion === 'number' ? n.typeVersion : 1,
      parameters: (n.parameters ?? {}) as JsonObject,
    });
  }
  const links: Link[] = [];
  const conns = (workflow.connections ?? {}) as Record<string, Record<string, Json>>;
  for (const [from, byType] of Object.entries(conns)) {
    const main = byType.main;
    if (!Array.isArray(main) || !nodes.has(from)) continue;
    main.forEach((slot, fromIdx) => {
      if (!Array.isArray(slot)) return;
      for (const l of slot as Record<string, Json>[]) if (nodes.has(String(l.node))) links.push({ from, fromIdx, to: String(l.node) });
    });
  }
  return { nodes, links };
}

function topoOrder(nodes: Map<string, RawNode>, links: Link[]): string[] {
  const indeg = new Map([...nodes.keys()].map((k) => [k, 0]));
  for (const l of links) indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([k]) => k);
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    order.push(cur);
    for (const l of links.filter((x) => x.from === cur)) {
      const d = (indeg.get(l.to) ?? 0) - 1;
      indeg.set(l.to, d);
      if (d === 0) queue.push(l.to);
    }
  }
  if (order.length !== nodes.size) throw new SimError('O workflow contém um ciclo; o simulador não o suporta.');
  return order;
}

function simulate(req: EngineRunRequest): EngineRunResult {
  const trace: TraceEntry[] = [];
  try {
    const { nodes, links } = buildGraph(req.workflow);
    if (nodes.size === 0) throw new SimError('O workflow não possui nós executáveis.');
    const order = topoOrder(nodes, links);
    if (req.targetNode != null && !nodes.has(req.targetNode)) {
      throw new SimError(`O nó alvo "${req.targetNode}" não existe neste workflow.`);
    }
    const input = asItems(req.fixture.input);
    const mocks = req.fixture.mocks ?? {};
    for (const name of Object.keys(mocks)) {
      if (!nodes.has(name)) throw new SimError(`O mock refere-se a um nó inexistente: "${name}".`);
    }
    const outputs = new Map<string, NodeOut>();
    for (const name of order) {
      const node = nodes.get(name) as RawNode;
      const incoming = links.filter((l) => l.to === name);
      const inItems: Json[] = incoming.flatMap((l) => outputs.get(l.from)?.[l.fromIdx] ?? []);
      const isStart = incoming.length === 0;
      let out: Json[];
      if (Object.hasOwn(mocks, name)) {
        out = asItems(mocks[name] as Json[]);
        trace.push({ node: name, type: node.type, status: 'mocked', itemsOut: out.length, note: 'Saída definida pelo mock da fixture.' });
      } else if (node.disabled) {
        out = isStart ? [] : inItems;
        trace.push({ node: name, type: node.type, status: 'disabled', itemsOut: out.length, note: 'Nó desabilitado: repassa os dados.' });
      } else if (isStart && (isTriggerType(node.type) || node.type.endsWith('.noOp') || node.type.endsWith('.manualTrigger'))) {
        out = structuredClone(input);
        trace.push({ node: name, type: node.type, status: 'executed', itemsOut: out.length, note: 'Gatilho alimentado com a entrada da fixture.' });
      } else if (node.type.endsWith('.noOp')) {
        out = inItems;
        trace.push({ node: name, type: node.type, status: 'passthrough', itemsOut: out.length });
      } else if (node.type.endsWith('.set')) {
        out = applySet(node, inItems);
        trace.push({ node: name, type: node.type, status: 'executed', itemsOut: out.length });
      } else {
        throw new SimError(
          `O nó "${name}" (${node.type}) não pode ser simulado. Defina um mock em fixture.mocks["${name}"].`, name,
        );
      }
      if (out.length > MAX_ITEMS) throw new SimError(`Itens demais em "${name}" (máx. ${MAX_ITEMS}).`, name);
      outputs.set(name, [out]);
      // saídas múltiplas só existem para nós mockados/IF, que o simulador não executa.
    }
    const hasOut = new Set(links.map((l) => l.from));
    const sinks = order.filter((n) => !hasOut.has(n));
    let target = req.targetNode ?? null;
    if (target === null) {
      if (sinks.length !== 1) throw new SimError(`O workflow tem ${sinks.length} nós finais; defina o nó alvo do teste.`);
      target = sinks[0] as string;
    }
    const data: DataRoot = {
      input,
      output: outputs.get(target)?.[0] ?? [],
      nodes: Object.fromEntries([...outputs].map(([k, v]) => [k, v[0] ?? []])),
    };
    return { status: 'completed', data, trace };
  } catch (e) {
    if (e instanceof SimError) {
      return { status: 'error', data: null, trace, error: e.message, ...(e.node ? { errorNode: e.node } : {}) };
    }
    return { status: 'error', data: null, trace, error: 'Falha inesperada na simulação.' };
  }
}

export const simulatedEngine: Engine = {
  info(): EngineInfo {
    return {
      id: 'simulated',
      label: 'Simulada',
      description:
        'Percorre o grafo do workflow com dados da fixture. Executa apenas gatilhos, noOp e Set com valores literais; demais nós exigem mocks. NÃO executa o n8n.',
      realExecution: false,
      implemented: true,
      available: true,
    };
  },
  run: (req) => Promise.resolve(simulate(req)),
};
