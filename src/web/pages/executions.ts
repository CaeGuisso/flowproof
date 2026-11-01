import { get } from '../api.ts';
import { fmtDate, fmtMs, h } from '../dom.ts';
import { badge, button, card, emptyState, engineBadge, jsonBlock, loadInto, noteBox, pageHeader, statusBadge, table } from '../ui.ts';
import type { Execution, ExecutionDetail } from '../types.ts';
import { compact, diffTable } from './diffview.ts';

export function executionsPage(root: HTMLElement, query: URLSearchParams): void {
  const status = h('select', { class: 'select', 'aria-label': 'Status' }, h('option', { value: '' }, 'Todos os status'), h('option', { value: 'passed' }, 'Aprovados'), h('option', { value: 'failed' }, 'Reprovados'), h('option', { value: 'error' }, 'Erros'));
  const engine = h('select', { class: 'select', 'aria-label': 'Engine' }, h('option', { value: '' }, 'Todas as engines'), h('option', { value: 'simulated' }, 'Simulada'), h('option', { value: 'real_local' }, 'Real local'), h('option', { value: 'real_container' }, 'Real em contêiner'));
  const regr = h('input', { type: 'checkbox', id: 'regr' });
  status.value = query.get('status') ?? ''; engine.value = query.get('engine') ?? ''; regr.checked = query.get('regression') === '1';
  const list = h('div');
  const PAGE = 25;
  let offset = 0;
  const base = (): URLSearchParams => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    for (const k of ['projectId', 'workflowId', 'testId']) { const v = query.get(k); if (v) q.set(k, v); }
    if (status.value) q.set('status', status.value);
    if (engine.value) q.set('engine', engine.value);
    if (regr.checked) q.set('regression', '1');
    return q;
  };
  const rowsOf = (items: Execution[]): Node[][] => items.map((e) => [
    h('a', { href: `#/executions/${e.id}` }, e.testName), h('span', { class: 'muted' }, e.workflowName), engineBadge(e.engine),
    h('span', { class: 'row-gap' }, statusBadge(e.status), e.regression ? badge('regressão', 'bad') : null), `${e.assertionsPassed}/${e.assertionsPassed + e.assertionsFailed}`, fmtMs(e.durationMs), fmtDate(e.startedAt)]) as Node[][];
  const draw = (): void => void loadInto(list, async () => {
    offset = 0;
    const r = await get<{ total: number; items: Execution[] }>(`/api/executions?${base()}`);
    if (r.total === 0) return emptyState({ icon: 'history', title: 'Nenhuma execução encontrada', text: 'Ajuste os filtros ou execute um caso de teste.' });
    const tbody = table(['Teste', 'Workflow', 'Engine', 'Status', 'Assertions', 'Duração', 'Data'], rowsOf(r.items));
    const more = h('div', { class: 'row-center' });
    const refreshMore = (shown: number): void => {
      more.replaceChildren(h('span', { class: 'muted small' }, `${shown} de ${r.total}`), ...(shown < r.total ? [button('Carregar mais', { onClick: async () => {
        offset += PAGE; const q = base(); q.set('offset', String(offset));
        const next = await get<{ items: Execution[] }>(`/api/executions?${q}`);
        const body = tbody.querySelector('tbody') as HTMLElement;
        for (const row of rowsOf(next.items)) { const tr = h('tr', null); for (const c of row) tr.appendChild(h('td', null, c)); body.appendChild(tr); }
        refreshMore(shown + next.items.length);
      } })] : []));
    };
    refreshMore(r.items.length);
    return [tbody, more];
  });
  for (const el of [status, engine, regr]) el.addEventListener('change', draw);
  root.append(pageHeader('Execuções', 'Histórico de todas as execuções de testes.'),
    card(h('div', { class: 'row-gap wrap filters' }, status, engine, h('label', { class: 'check', for: 'regr' }, regr, 'Somente regressões')), list));
  draw();
}

export function executionDetailPage(root: HTMLElement, id: string): void {
  const host = h('div', { class: 'stack-lg' });
  root.appendChild(host);
  void loadInto(host, async () => {
    const e = await get<ExecutionDetail>(`/api/executions/${id}`);
    const meta = (l: string, v: Node | string): HTMLElement => h('div', { class: 'meta-item' }, h('span', { class: 'muted small' }, l), h('div', null, v));
    const out: (Node | null)[] = [
      pageHeader(e.testName, h('span', { class: 'row-gap wrap' }, statusBadge(e.status), engineBadge(e.engine), e.regression ? badge('regressão', 'bad') : null), null,
        h('nav', { class: 'crumbs', 'aria-label': 'Navegação' }, h('a', { href: '#/executions' }, 'Execuções'), ' / ', e.testName)),
      !e.realExecution ? noteBox('info', h('strong', null, 'Execução simulada. '), 'Este resultado vem do simulador do FlowProof (grafo + fixture + mocks) e não representa uma execução real no n8n.') : null,
      e.regression ? noteBox('warn', h('strong', null, 'Regressão detectada. '), 'A execução anterior deste teste (mesma engine) passou e esta não. ', e.baselineExecutionId ? h('a', { href: `#/executions/${e.baselineExecutionId}` }, 'Ver execução anterior') : null) : null,
      card(h('div', { class: 'meta-grid' },
        meta('Projeto', h('a', { href: `#/projects/${e.projectId}` }, e.projectName)), meta('Workflow', h('a', { href: `#/workflows/${e.workflowId}` }, `${e.workflowName}${e.workflowVersion ? ` (v${e.workflowVersion})` : ''}`)),
        meta('Caso de teste', e.testCaseId ? h('a', { href: `#/tests/${e.testCaseId}` }, e.testName) : `${e.testName} (removido)`), meta('Data', fmtDate(e.startedAt)), meta('Duração', fmtMs(e.durationMs)),
        meta('Assertions', `${e.assertionsPassed} aprovada(s) · ${e.assertionsFailed} reprovada(s)`))),
      e.error ? h('div', { class: 'alert alert-bad', role: 'alert' }, h('div', null, h('strong', null, 'Erro de execução. '), e.error, e.errorNode ? h('div', { class: 'muted small' }, `Nó: ${e.errorNode}`) : null)) : null,
      e.assertions.length > 0 ? card(h('div', { class: 'card-head' }, h('h2', null, 'Assertions')), table(['', 'Caminho', 'Operador', 'Esperado', 'Obtido', 'Resultado'], e.assertions.map((a) => [
        a.passed ? badge('ok', 'ok') : badge('falhou', 'bad'), h('code', null, a.path), a.op, h('code', null, a.expected === undefined ? '—' : compact(a.expected)), h('code', null, a.found ? compact(a.actual) : '(ausente)'), a.message]))) : null,
      e.trace.length > 0 ? card(h('div', { class: 'card-head' }, h('h2', null, 'Trilha de execução')), table(['Nó', 'Tipo', 'Como foi processado', 'Itens', 'Observação'], e.trace.map((t) => [
        t.node, h('code', null, t.type), badge({ executed: 'executado', mocked: 'mock', passthrough: 'repasse', disabled: 'desabilitado' }[t.status], t.status === 'mocked' ? 'info' : 'muted'), String(t.itemsOut), t.note ?? '—']))) : null,
      card(h('div', { class: 'card-head' }, h('h2', null, 'Diferenças em relação à execução anterior'), e.baselineExecutionId ? h('a', { href: `#/executions/${e.baselineExecutionId}` }, 'Abrir anterior') : null),
        e.baselineExecutionId === null ? h('p', { class: 'muted' }, 'Esta é a primeira execução deste teste nesta engine; não há base de comparação.')
          : e.diff.length === 0 ? h('p', { class: 'muted' }, 'Nenhuma diferença nos dados de saída.') : diffTable(e.diff)),
      e.output ? card(h('div', { class: 'card-head' }, h('h2', null, 'Dados (input, output e nós)')), jsonBlock(e.output, 'tall')) : null,
    ];
    return out.filter((n): n is Node => n !== null);
  });
}
