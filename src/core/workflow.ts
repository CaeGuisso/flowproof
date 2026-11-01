import { diffJson } from './diff.ts';
import type {
  DiffEntry, GraphEdge, GraphNode, Json, JsonObject, NodeChange, WorkflowDiff, WorkflowSummary,
} from './types.ts';

export const MAX_NODES = 2000;
const MAX_DEPTH = 40;
const MAX_VISITS = 300_000;
const REDACTED = '[REDACTED]';
const EMAIL_MASK = '[email-masked]';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SECRET_KEY =
  /(password|passwd|passphrase|(^|[_-])pass$|secret|token|api[-_ ]?key|apikey|authorization|auth[-_ ]?header|private[-_ ]?key|bearer|client[-_ ]?secret|access[-_ ]?key|session[-_ ]?id|cookie|signature|credential(s)?$)/i;

const VALUE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const TOP_KEYS = new Set(['name', 'nodes', 'connections', 'settings', 'active']);
const NODE_KEYS = new Set([
  'id', 'name', 'type', 'typeVersion', 'position', 'parameters', 'disabled', 'notes', 'notesInFlow',
  'credentials', 'onError', 'retryOnFail', 'alwaysOutputData', 'executeOnce', 'continueOnFail',
]);

export interface ImportOk {
  ok: true;
  sanitized: JsonObject;
  summary: WorkflowSummary;
  redactedPaths: string[];
  warnings: string[];
}
export interface ImportFail {
  ok: false;
  errors: string[];
}

class Ctx {
  visits = 0;
  redacted: string[] = [];
  warnings = new Set<string>();
}

function isExpression(v: string): boolean {
  return v.startsWith('=') && v.includes('{{');
}

function scrubString(value: string, path: string, ctx: Ctx): string {
  let out = value;
  let changed = false;
  for (const re of VALUE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, REDACTED);
      changed = true;
    }
  }
  EMAIL.lastIndex = 0;
  if (EMAIL.test(out)) {
    EMAIL.lastIndex = 0;
    out = out.replace(EMAIL, EMAIL_MASK);
    changed = true;
  }
  if (changed) ctx.redacted.push(path);
  return out;
}

function scrub(value: unknown, path: string, ctx: Ctx, depth: number): Json {
  ctx.visits += 1;
  if (ctx.visits > MAX_VISITS) throw new Error('Workflow grande demais para processar.');
  if (depth > MAX_DEPTH) throw new Error('Estrutura aninhada demais.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return scrubString(value, path, ctx);
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, `${path}[${i}]`, ctx, depth + 1));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: JsonObject = {};
    const nameField = typeof obj.name === 'string' ? obj.name : null;
    const pairSecret = nameField !== null && SECRET_KEY.test(nameField) && typeof obj.value === 'string';
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.has(k)) {
        ctx.warnings.add('Chaves reservadas (__proto__, constructor, prototype) foram removidas.');
        continue;
      }
      const childPath = `${path}.${k}`;
      const secretValue = typeof v === 'string' && v.length > 0 && !isExpression(v);
      if ((SECRET_KEY.test(k) || (pairSecret && k === 'value')) && secretValue) {
        out[k] = REDACTED;
        ctx.redacted.push(childPath);
      } else {
        out[k] = scrub(v, childPath, ctx, depth + 1);
      }
    }
    return out;
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Valida, sanitiza e resume um workflow exportado do n8n. Nunca executa nada do conteúdo. */
export function importWorkflow(raw: unknown, fallbackName?: string): ImportOk | ImportFail {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['O arquivo deve conter um objeto JSON de workflow do n8n.'] };
  const nodesRaw = raw.nodes;
  if (!Array.isArray(nodesRaw)) return { ok: false, errors: ['Campo "nodes" ausente ou não é uma lista.'] };
  if (nodesRaw.length === 0) errors.push('O workflow não possui nós.');
  if (nodesRaw.length > MAX_NODES) errors.push(`Máximo de ${MAX_NODES} nós por workflow.`);
  if (!isPlainObject(raw.connections)) errors.push('Campo "connections" ausente ou inválido.');
  if (errors.length > 0) return { ok: false, errors };

  const names = new Set<string>();
  nodesRaw.forEach((n, i) => {
    if (!isPlainObject(n)) return void errors.push(`Nó #${i + 1} não é um objeto.`);
    if (typeof n.name !== 'string' || n.name.trim() === '' || n.name.length > 200) {
      return void errors.push(`Nó #${i + 1} sem "name" válido.`);
    }
    if (typeof n.type !== 'string' || !/^[\w@.\-/]{1,200}$/.test(n.type)) {
      errors.push(`Nó "${n.name}" sem "type" válido.`);
    }
    if (FORBIDDEN_KEYS.has(n.name)) errors.push(`Nome de nó não permitido: ${n.name}`);
    if (names.has(n.name)) errors.push(`Nome de nó duplicado: "${n.name}".`);
    names.add(n.name);
    if (n.parameters !== undefined && !isPlainObject(n.parameters)) errors.push(`Nó "${n.name}": "parameters" deve ser objeto.`);
  });
  const connections = raw.connections as Record<string, unknown>;
  for (const [from, byType] of Object.entries(connections)) {
    if (!names.has(from)) errors.push(`Conexão parte de nó inexistente: "${from}".`);
    if (!isPlainObject(byType)) {
      errors.push(`Conexões de "${from}" inválidas.`);
      continue;
    }
    for (const outputs of Object.values(byType)) {
      if (!Array.isArray(outputs)) { errors.push(`Conexões de "${from}" inválidas.`); continue; }
      for (const slot of outputs) {
        if (slot === null) continue;
        if (!Array.isArray(slot)) { errors.push(`Conexões de "${from}" inválidas.`); continue; }
        for (const link of slot) {
          if (!isPlainObject(link) || typeof link.node !== 'string' || !names.has(link.node)) {
            errors.push(`Conexão de "${from}" aponta para nó inexistente.`);
          }
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) };

  const ctx = new Ctx();
  const sanitized: JsonObject = {};
  try {
    const dropped: string[] = [];
    for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) dropped.push(k);
    if (dropped.length > 0) {
      const sensitive = ['pinData', 'staticData', 'meta'].filter((k) => dropped.includes(k));
      if (sensitive.length > 0) ctx.warnings.add(`Campos removidos por segurança: ${sensitive.join(', ')}.`);
    }
    sanitized.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : fallbackName ?? 'Workflow';
    sanitized.active = raw.active === true;
    if (raw.settings !== undefined) sanitized.settings = scrub(raw.settings, 'settings', ctx, 0);
    sanitized.nodes = (nodesRaw as Record<string, unknown>[]).map((n, i) => {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(n)) {
        if (!NODE_KEYS.has(k)) {
          if (k === 'webhookId') ctx.redacted.push(`nodes[${i}].webhookId`);
          continue;
        }
        if (k === 'credentials') {
          const creds: JsonObject = {};
          if (isPlainObject(v)) {
            for (const t of Object.keys(v)) if (!FORBIDDEN_KEYS.has(t)) creds[t] = { redacted: true };
            ctx.redacted.push(`nodes[${i}].credentials`);
          }
          out.credentials = creds;
        } else if (k === 'position') {
          const ok = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
          out.position = ok ? (v as number[]) : [0, 0];
          if (!ok) ctx.warnings.add('Alguns nós sem posição válida foram posicionados em (0,0).');
        } else {
          out[k] = scrub(v, `nodes[${i}].${k}`, ctx, 1);
        }
      }
      if (out.parameters === undefined) out.parameters = {};
      if (out.position === undefined) {
        out.position = [0, 0];
        ctx.warnings.add('Alguns nós sem posição válida foram posicionados em (0,0).');
      }
      return out;
    });
    sanitized.connections = scrub(connections, 'connections', ctx, 0);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : 'Falha ao processar o workflow.'] };
  }
  if (ctx.redacted.length > 0) {
    ctx.warnings.add(`${ctx.redacted.length} valor(es) sensível(is) foram removidos ou mascarados antes de salvar.`);
  }
  return {
    ok: true,
    sanitized,
    summary: summarizeWorkflow(sanitized),
    redactedPaths: ctx.redacted.slice(0, 500),
    warnings: [...ctx.warnings],
  };
}

export function summarizeWorkflow(w: JsonObject): WorkflowSummary {
  const rawNodes = (w.nodes as Record<string, Json>[]) ?? [];
  const nodes: GraphNode[] = rawNodes.map((n) => ({
    name: String(n.name),
    type: String(n.type),
    typeVersion: typeof n.typeVersion === 'number' ? n.typeVersion : null,
    position: n.position as [number, number],
    disabled: n.disabled === true,
    credentialTypes: isPlainObject(n.credentials) ? Object.keys(n.credentials) : [],
  }));
  const edges: GraphEdge[] = [];
  const conns = (w.connections as Record<string, Record<string, Json>>) ?? {};
  for (const [from, byType] of Object.entries(conns)) {
    for (const [type, slots] of Object.entries(byType)) {
      (slots as Json[]).forEach((slot, outputIndex) => {
        if (!Array.isArray(slot)) return;
        for (const link of slot as Record<string, Json>[]) {
          edges.push({
            from, to: String(link.node), type, outputIndex,
            inputIndex: typeof link.index === 'number' ? link.index : 0,
          });
        }
      });
    }
  }
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  return {
    name: String(w.name ?? ''),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    triggerCount: nodes.filter((n) => isTriggerType(n.type)).length,
    typeCounts,
    nodes,
    edges,
  };
}

export function isTriggerType(type: string): boolean {
  return /trigger$/i.test(type) || /\.webhook$/i.test(type) || /\.start$/i.test(type);
}

const edgeKey = (e: GraphEdge): string => `${e.from}|${e.type}|${e.outputIndex}|${e.to}|${e.inputIndex}`;

export function diffWorkflows(a: JsonObject, b: JsonObject): WorkflowDiff {
  const sa = summarizeWorkflow(a);
  const sb = summarizeWorkflow(b);
  const na = new Map((a.nodes as Record<string, Json>[]).map((n) => [String(n.name), n]));
  const nb = new Map((b.nodes as Record<string, Json>[]).map((n) => [String(n.name), n]));
  const nodesAdded = [...nb.keys()].filter((k) => !na.has(k));
  const nodesRemoved = [...na.keys()].filter((k) => !nb.has(k));
  const nodesChanged: NodeChange[] = [];
  const nodesMoved: string[] = [];
  for (const [name, before] of na) {
    const after = nb.get(name);
    if (!after) continue;
    const { position: pa, ...restA } = before;
    const { position: pb, ...restB } = after;
    const changes: DiffEntry[] = diffJson(restA, restB, 200);
    if (changes.length > 0) nodesChanged.push({ name, changes });
    if (JSON.stringify(pa) !== JSON.stringify(pb)) nodesMoved.push(name);
  }
  const ka = new Map(sa.edges.map((e) => [edgeKey(e), e]));
  const kb = new Map(sb.edges.map((e) => [edgeKey(e), e]));
  const edgesAdded = [...kb].filter(([k]) => !ka.has(k)).map(([, e]) => e);
  const edgesRemoved = [...ka].filter(([k]) => !kb.has(k)).map(([, e]) => e);
  return {
    nodesAdded, nodesRemoved, nodesChanged, nodesMoved, edgesAdded, edgesRemoved,
    hasRelevantChanges: nodesAdded.length + nodesRemoved.length + nodesChanged.length + edgesAdded.length + edgesRemoved.length > 0,
  };
}
