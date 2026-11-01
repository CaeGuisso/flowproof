import { get } from '../api.ts';
import { fmtAgo, fmtMs, h, icon, svg } from '../dom.ts';
import { card, emptyState, engineBadge, loadInto, noteBox, pageHeader, statusBadge, table } from '../ui.ts';
import type { Dashboard } from '../types.ts';
import { go, plural } from './shared.ts';

const PHRASES: Record<string, string> = {
  'created:project': 'Você criou o projeto', 'updated:project': 'Você atualizou o projeto', 'deleted:project': 'Você excluiu o projeto',
  'imported:workflow': 'Você importou o workflow', 'new_version:workflow': 'Você criou uma nova versão de', 'exported:workflow': 'Você exportou o workflow',
  'deleted:workflow': 'Você excluiu o workflow', 'ran:workflow': 'Você executou testes de', 'created:test': 'Você criou o teste', 'updated:test': 'Você atualizou o teste',
  'duplicated:test': 'Você duplicou o teste', 'deleted:test': 'Você excluiu o teste', 'registered:user': 'Você criou a conta',
};

function dailyChart(daily: Dashboard['daily']): HTMLElement {
  const W = 560; const H = 140; const pad = 22;
  const max = Math.max(1, ...daily.map((d) => d.passed + d.failed));
  const bw = Math.min(36, (W - pad * 2) / daily.length - 8);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H + 22}`, class: 'chart', role: 'img', 'aria-label': 'Execuções por dia' });
  s.appendChild(svg('line', { x1: pad, x2: W - pad, y1: H, y2: H, class: 'chart-axis' }));
  daily.forEach((d, i) => {
    const x = pad + (i + 0.5) * ((W - pad * 2) / daily.length) - bw / 2;
    const hp = (d.passed / max) * (H - 10);
    const hf = (d.failed / max) * (H - 10);
    const g = svg('g'); g.appendChild(svg('title', {}, `${d.day}: ${d.passed} aprovadas, ${d.failed} com falha/erro`));
    g.appendChild(svg('rect', { x, y: H - hp, width: bw, height: hp, class: 'bar-ok', rx: 2 }));
    g.appendChild(svg('rect', { x, y: H - hp - hf, width: bw, height: hf, class: 'bar-bad', rx: 2 }));
    g.appendChild(svg('text', { x: x + bw / 2, y: H + 15, class: 'chart-label', 'text-anchor': 'middle' }, d.day.slice(5).split('-').reverse().join('/')));
    s.appendChild(g);
  });
  return s as unknown as HTMLElement;
}

function onboarding(d: Dashboard): HTMLElement {
  const steps = [
    { done: d.totals.projects > 0, title: 'Criar projeto', text: 'Agrupe os workflows de um cliente ou produto.', href: '#/projects' },
    { done: d.totals.workflows > 0, title: 'Importar workflow', text: 'Envie o JSON exportado do n8n. Segredos são removidos.', href: '#/projects' },
    { done: d.totals.tests > 0, title: 'Criar caso de teste', text: 'Defina uma entrada e o que deve existir na saída.', href: '#/projects' },
    { done: d.totals.executions > 0, title: 'Executar teste', text: 'Rode na engine simulada e registre o histórico.', href: '#/projects' },
    { done: d.totals.executions > 0, title: 'Consultar resultado', text: 'Veja assertions, diferenças e regressões.', href: '#/executions' },
  ];
  const next = steps.findIndex((s) => !s.done);
  return card(
    h('div', { class: 'card-head' }, h('h2', null, 'Primeiros passos'), h('span', { class: 'muted' }, `${steps.filter((s) => s.done).length} de ${steps.length}`)),
    h('ol', { class: 'steps' }, ...steps.map((s, i) => h('li', { class: `step${s.done ? ' done' : ''}${i === next ? ' current' : ''}` },
      h('span', { class: 'step-dot' }, s.done ? icon('check', 14) : String(i + 1)),
      h('div', null, h('strong', null, s.title), h('p', { class: 'muted' }, s.text))))),
    h('a', { class: 'btn btn-primary', href: '#/projects' }, d.totals.projects === 0 ? 'Criar meu primeiro projeto' : 'Ir para projetos'),
  );
}

export function dashboardPage(root: HTMLElement): void {
  const body = h('div', { class: 'stack-lg' });
  root.append(pageHeader('Visão geral', 'Qualidade das suas automações em um só lugar.'), body);
  void loadInto(body, async () => {
    const d = await get<Dashboard>('/api/dashboard');
    const out: Node[] = [];
    const stat = (label: string, value: string | number, sub?: string, tone = ''): HTMLElement =>
      h('div', { class: `stat ${tone}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, String(value)), sub ? h('span', { class: 'muted small' }, sub) : null);
    out.push(h('div', { class: 'stats' },
      stat('Projetos', d.totals.projects), stat('Workflows', d.totals.workflows), stat('Casos de teste', d.totals.tests),
      stat('Execuções', d.totals.executions, d.totals.executions ? `${d.byEngine.simulated ?? 0} simuladas · ${(d.totals.executions) - (d.byEngine.simulated ?? 0)} reais` : undefined),
      stat('Taxa de aprovação', d.passRate === null ? '—' : `${d.passRate}%`, d.passRate === null ? 'Sem execuções ainda' : undefined, d.passRate !== null && d.passRate < 100 ? 'warn' : ''),
      stat('Falhas', d.totals.failed + d.totals.errors, d.totals.errors ? `${d.totals.failed} reprovações · ${d.totals.errors} erros` : undefined, d.totals.failed + d.totals.errors ? 'bad' : '')));
    if (d.totals.projects === 0 || d.totals.executions === 0) out.push(onboarding(d));
    if (d.totals.executions > 0 && (d.byEngine.simulated ?? 0) === d.totals.executions) {
      out.push(noteBox('info', h('strong', null, 'Todas as execuções são simuladas. '), 'A engine simulada não executa o n8n; ela percorre o grafo com dados da fixture e mocks. Execução real ainda não está disponível.'));
    }
    if (d.daily.length > 0) out.push(card(h('div', { class: 'card-head' }, h('h2', null, 'Execuções por dia'), h('span', { class: 'legend' }, h('i', { class: 'dot dot-ok' }), 'Aprovadas', h('i', { class: 'dot dot-bad' }), 'Falhas/erros')), dailyChart(d.daily)));
    const recent = d.recent.length === 0
      ? emptyState({ icon: 'history', title: 'Nenhuma execução ainda', text: 'Execute um caso de teste para ver o histórico aqui.' })
      : table(['Teste', 'Workflow', 'Engine', 'Status', 'Duração', 'Quando'], d.recent.map((e) => [
        h('a', { href: `#/executions/${e.id}` }, e.testName), e.workflowName, engineBadge(e.engine),
        h('span', { class: 'row-gap' }, statusBadge(e.status), e.regression ? h('span', { class: 'badge badge-bad' }, 'regressão') : null), fmtMs(e.durationMs), fmtAgo(e.startedAt)]));
    out.push(card(h('div', { class: 'card-head' }, h('h2', null, 'Últimas execuções'), h('a', { href: '#/executions' }, 'Ver todas')), recent));
    out.push(h('div', { class: 'grid-2' },
      card(h('div', { class: 'card-head' }, h('h2', null, 'Atividade recente')),
        d.activity.length === 0 ? h('p', { class: 'muted' }, 'Sem atividade.')
          : h('ul', { class: 'activity' }, ...d.activity.map((a) => h('li', null, h('span', null, `${PHRASES[`${a.action}:${a.entity}`] ?? `Você ${a.action}`} `, h('strong', null, a.label ?? '')), h('span', { class: 'muted small' }, fmtAgo(a.createdAt)))))),
      d.projectOverview.length > 0 ? card(h('div', { class: 'card-head' }, h('h2', null, 'Qualidade por projeto'), h('a', { href: '#/projects' }, 'Ver projetos')),
        h('div', { class: 'quality-list' }, ...d.projectOverview.map((p) => {
          const bar = h('div', { class: 'bar' }, h('div', { class: `bar-fill${p.quality !== null && p.quality < 100 ? ' warn' : ''}` }));
          (bar.firstChild as HTMLElement).style.setProperty('width', `${p.quality ?? 0}%`);
          return h('button', { class: 'quality-row', type: 'button', onclick: () => go(`/projects/${p.id}`) },
            h('div', null, h('strong', null, p.name), h('div', { class: 'muted small' }, `${p.client ? `${p.client} · ` : ''}${plural(p.workflows, 'workflow', 'workflows')} · ${plural(p.tests, 'teste', 'testes')}`)),
            h('div', { class: 'quality-meter' }, bar, h('span', { class: 'mono' }, p.quality === null ? 'sem dados' : `${p.quality}%`)));
        }))) : h('div')));
    return out;
  });
}
