import { del, get, post } from '../api.ts';
import { fmtAgo, fmtDate, h, icon } from '../dom.ts';
import { workflowGraph } from '../graph.ts';
import {
  badge, button, card, emptyState, engineBadge, errMsg, loadInto, noteBox, pageHeader, statusBadge, table, tabs, toast, typedConfirm, confirmDialog, spinner,
} from '../ui.ts';
import type { Execution, Json, TestCase, VersionMeta, WorkflowDetail, WorkflowDiff, WorkflowSummary } from '../types.ts';
import { workflowDiffView } from './diffview.ts';
import { importModal } from './projects.ts';
import { engineSelect, getEngines, go, plural } from './shared.ts';

type TabId = 'structure' | 'versions' | 'tests';

export function workflowPage(root: HTMLElement, id: string, initialTab: TabId = 'structure'): void {
  const host = h('div', { class: 'stack-lg' });
  root.appendChild(host);
  let tab: TabId = initialTab;
  const reload = (): void => void loadInto(host, async () => {
    const w = await get<WorkflowDetail>(`/api/workflows/${id}`);
    const content = await get<{ content: { nodes: { name: string; parameters?: Json }[] } }>(`/api/workflows/${id}/versions/${w.current.version}`);
    const panel = h('div', { class: 'stack-lg' });
    const draw = (): void => { void loadInto(panel, async () => (tab === 'structure' ? structure(w, content.content.nodes) : tab === 'versions' ? versions(w) : testsTab(w, reload))); };
    const tabBar = h('div');
    const drawTabs = (): void => { tabBar.replaceChildren(tabs([{ id: 'structure', label: 'Estrutura' }, { id: 'versions', label: `Versões (${w.versions.length})` }, { id: 'tests', label: 'Testes' }], tab, (t) => { tab = t as TabId; drawTabs(); draw(); })); };
    drawTabs(); draw();
    const actions = h('div', { class: 'row-gap wrap' },
      button('Nova versão', { kind: 'primary', icon: 'upload', onClick: () => importModal('Importar nova versão', 'Envie o JSON atualizado deste workflow. Se o conteúdo sanitizado for idêntico à versão atual, nada é criado.',
        async (workflow) => { const r = await post<{ unchanged: boolean }>(`/api/workflows/${id}/versions`, { workflow }); toast(r.unchanged ? 'Sem alterações: o conteúdo é idêntico à versão atual.' : 'Nova versão criada.', r.unchanged ? 'info' : 'success'); reload(); }, false) }),
      h('a', { class: 'btn', href: `/api/workflows/${id}/export`, download: '' }, icon('download', 16), 'Exportar'),
      button('Excluir', { kind: 'danger', icon: 'trash', onClick: async () => {
        const typed = await typedConfirm({ title: 'Excluir workflow', message: 'As versões, os testes e o histórico de execuções deste workflow serão removidos permanentemente.', name: w.name, confirmLabel: 'Excluir workflow' });
        if (typed === null) return;
        try { await del(`/api/workflows/${id}`, { confirmName: typed }); toast('Workflow excluído.', 'success'); go(`/projects/${w.projectId}`); } catch (e) { toast(errMsg(e), 'error'); }
      } }));
    return [
      pageHeader(w.name, h('span', { class: 'row-gap wrap' }, badge(`v${w.current.version}`, 'accent'), w.isExample ? badge('exemplo', 'info') : null, `Atualizado ${fmtAgo(w.updatedAt)}`), actions,
        h('nav', { class: 'crumbs', 'aria-label': 'Navegação' }, h('a', { href: '#/projects' }, 'Projetos'), ' / ', h('a', { href: `#/projects/${w.projectId}` }, w.projectName), ' / ', w.name)),
      tabBar, panel,
    ];
  });
  reload();
}

const nonNull = (list: (Node | null)[]): Node[] => list.filter((n): n is Node => n !== null);

function structure(w: WorkflowDetail, nodes: { name: string; parameters?: Json }[]): Node[] {
  const s: WorkflowSummary = w.summary;
  const params = new Map(nodes.map((n) => [n.name, n.parameters ?? {}]));
  const stat = (l: string, v: string | number): HTMLElement => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, l), h('span', { class: 'stat-value' }, String(v)));
  return nonNull([
    h('div', { class: 'stats' }, stat('Nós', s.nodeCount), stat('Conexões', s.edgeCount), stat('Gatilhos', s.triggerCount), stat('Tipos distintos', Object.keys(s.typeCounts).length), stat('Valores protegidos', w.current.redactionCount)),
    w.current.redactionCount > 0 ? noteBox('warn', h('strong', null, 'Dados sensíveis foram removidos na importação. '), `${w.current.redactionCount} valor(es) (credenciais, tokens, chaves, e-mails, pinData) foram removidos ou mascarados antes de salvar. O workflow exportado reflete a versão sanitizada.`) : null,
    ...w.current.warnings.filter((x) => !x.includes('valor(es) sensível')).map((x) => noteBox('info', x)),
    card(h('div', { class: 'card-head' }, h('h2', null, 'Grafo'), h('span', { class: 'muted small' }, 'Visualização técnica das conexões (não é um editor).')), workflowGraph(s.nodes, s.edges, (n) => params.get(n) ?? {})),
    card(h('div', { class: 'card-head' }, h('h2', null, 'Nós')), table(['Nome', 'Tipo', 'Versão do nó', 'Credenciais', 'Estado'], s.nodes.map((n) => [
      n.name, h('code', null, n.type), n.typeVersion === null ? '—' : String(n.typeVersion), n.credentialTypes.length ? n.credentialTypes.join(', ') : '—', n.disabled ? badge('desabilitado', 'muted') : badge('ativo', 'ok')]))),
  ]);
}

function versions(w: WorkflowDetail): Node[] {
  const list = w.versions;
  const opt = (v: VersionMeta): HTMLOptionElement => h('option', { value: String(v.version) }, `v${v.version} · ${fmtDate(v.createdAt)}`);
  const from = h('select', { class: 'select', 'aria-label': 'Versão base' }, ...list.map(opt));
  const to = h('select', { class: 'select', 'aria-label': 'Versão nova' }, ...list.map(opt));
  if (list.length > 1) { from.value = String(list[1]?.version); to.value = String(list[0]?.version); }
  const result = h('div');
  const compare = button('Comparar', { kind: 'primary', onClick: async () => {
    result.replaceChildren(spinner());
    try {
      const r = await get<{ from: VersionMeta; to: VersionMeta; diff: WorkflowDiff }>(`/api/workflows/${w.id}/diff?from=${from.value}&to=${to.value}`);
      result.replaceChildren(h('h3', null, `v${r.from.version} → v${r.to.version}`), workflowDiffView(r.diff));
    } catch (e) { result.replaceChildren(h('p', { class: 'field-error' }, errMsg(e))); }
  } });
  return [
    card(h('div', { class: 'card-head' }, h('h2', null, 'Histórico de versões')), table(['Versão', 'Importada em', 'Nós', 'Valores protegidos', 'Hash'], list.map((v) => [
      badge(`v${v.version}`, v.version === w.current.version ? 'accent' : 'muted'), fmtDate(v.createdAt), String(v.nodeCount), String(v.redactionCount), h('code', null, v.contentHash.slice(0, 10))]))),
    card(h('div', { class: 'card-head' }, h('h2', null, 'Comparar versões')),
      list.length < 2 ? h('p', { class: 'muted' }, 'Importe uma nova versão para poder comparar mudanças.')
        : h('div', { class: 'stack' }, h('div', { class: 'row-gap wrap' }, 'De', from, 'para', to, compare), result)),
  ];
}

async function testsTab(w: WorkflowDetail, reloadAll: () => void): Promise<Node[]> {
  const [tests, engines] = await Promise.all([get<TestCase[]>(`/api/workflows/${w.id}/tests`), getEngines()]);
  const sel = engineSelect(engines);
  const real = engines.filter((e) => e.realExecution && !e.available);
  const run = async (testId: string | null): Promise<void> => {
    try {
      const out = testId ? [await post<Execution>(`/api/tests/${testId}/run`, { engine: sel.value })] : await post<Execution[]>(`/api/workflows/${w.id}/run`, { engine: sel.value });
      const ok = out.filter((e) => e.status === 'passed').length;
      toast(`${ok}/${out.length} aprovado(s) na engine ${sel.selectedOptions[0]?.textContent ?? sel.value}.`, ok === out.length ? 'success' : 'error');
      reloadAll();
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const header = h('div', { class: 'row-between wrap' },
    h('div', { class: 'row-gap wrap' }, h('label', { class: 'muted', for: 'eng' }, 'Engine'), sel,
      button('Executar todos', { icon: 'play', onClick: () => run(null) })),
    h('a', { class: 'btn btn-primary', href: `#/workflows/${w.id}/tests/new` }, icon('plus', 16), 'Novo teste'));
  sel.id = 'eng';
  const body = tests.length === 0
    ? emptyState({ icon: 'flask', title: 'Nenhum caso de teste', text: 'Defina uma entrada (fixture) e as verificações sobre a saída para detectar regressões.', action: h('a', { class: 'btn btn-primary', href: `#/workflows/${w.id}/tests/new` }, 'Criar primeiro teste') })
    : table(['Teste', 'Estado', 'Assertions', 'Último resultado', ''], tests.map((t) => [
      h('div', null, h('a', { href: `#/tests/${t.id}` }, t.name), t.description ? h('div', { class: 'muted small clamp' }, t.description) : null),
      t.status === 'active' ? badge('ativo', 'ok') : badge('desativado', 'muted'), plural(t.assertions.length, 'verificação', 'verificações'),
      t.lastExecution ? h('span', { class: 'row-gap wrap' }, statusBadge(t.lastExecution.status), engineBadge(t.lastExecution.engine), h('a', { class: 'small', href: `#/executions/${t.lastExecution.id}` }, fmtAgo(t.lastExecution.startedAt))) : h('span', { class: 'muted' }, 'Nunca executado'),
      h('div', { class: 'row-gap' },
        button('', { icon: 'play', title: 'Executar', onClick: () => (t.status === 'active' ? run(t.id) : void toast('Teste desativado.', 'info')) }),
        h('a', { class: 'btn', href: `#/tests/${t.id}`, title: 'Editar', 'aria-label': 'Editar' }, icon('edit', 16)),
        button('', { icon: 'copy', title: 'Duplicar', onClick: async () => { try { await post(`/api/tests/${t.id}/duplicate`); toast('Teste duplicado.', 'success'); reloadAll(); } catch (e) { toast(errMsg(e), 'error'); } } }),
        button('', { icon: 'trash', kind: 'danger', title: 'Excluir', onClick: async () => {
          if (!(await confirmDialog({ title: 'Excluir caso de teste', message: `"${t.name}" será removido. O histórico de execuções é mantido.`, confirmLabel: 'Excluir', danger: true }))) return;
          try { await del(`/api/tests/${t.id}`); toast('Teste excluído.', 'success'); reloadAll(); } catch (e) { toast(errMsg(e), 'error'); }
        } }))]));
  return nonNull([
    real.length > 0 ? noteBox('info', h('strong', null, 'Execução real indisponível. '), 'Apenas a engine simulada está ativa; ela não executa o n8n. Veja os detalhes em Configurações.') : null,
    card(header, body),
  ]);
}
