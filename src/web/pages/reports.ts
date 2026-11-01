import { get } from '../api.ts';
import { fmtDate, fmtMs, h, icon } from '../dom.ts';
import { badge, card, emptyState, engineBadge, loadInto, noteBox, pageHeader, statusBadge, table } from '../ui.ts';
import type { Project, Report } from '../types.ts';
import { go } from './shared.ts';

export function reportsPage(root: HTMLElement, projectId: string | null): void {
  const host = h('div', { class: 'stack-lg' });
  root.append(pageHeader('Relatórios', 'Resultado atual dos testes por projeto, com exportação.'), host);
  void loadInto(host, async () => {
    const projects = await get<Project[]>('/api/projects');
    if (projects.length === 0) return emptyState({ icon: 'report', title: 'Sem projetos', text: 'Crie um projeto e execute testes para gerar relatórios.', action: h('a', { class: 'btn btn-primary', href: '#/projects' }, 'Ir para projetos') });
    const id = projectId ?? (projects[0] as Project).id;
    const sel = h('select', { class: 'select', 'aria-label': 'Projeto' }, ...projects.map((p) => h('option', { value: p.id }, p.name)));
    sel.value = id;
    sel.addEventListener('change', () => go(`/reports/${sel.value}`));
    const r = await get<Report>(`/api/projects/${id}/report`);
    const stat = (l: string, v: number, tone = ''): HTMLElement => h('div', { class: `stat ${tone}` }, h('span', { class: 'stat-label' }, l), h('span', { class: 'stat-value' }, String(v)));
    return [
      h('div', { class: 'row-between wrap' }, h('div', { class: 'row-gap' }, 'Projeto', sel),
        h('div', { class: 'row-gap' }, h('a', { class: 'btn', href: `/api/projects/${id}/report.json`, download: '' }, icon('download', 16), 'JSON'), h('a', { class: 'btn', href: `/api/projects/${id}/report.junit.xml`, download: '' }, icon('download', 16), 'JUnit XML'))),
      noteBox('info', r.notice, ' Gerado em ', fmtDate(r.generatedAt), '. Considera o resultado mais recente de cada teste por engine.'),
      h('div', { class: 'stats' }, stat('Testes com resultado', r.summary.total), stat('Aprovados', r.summary.passed), stat('Reprovados', r.summary.failed, r.summary.failed ? 'bad' : ''), stat('Erros', r.summary.errors, r.summary.errors ? 'warn' : ''),
        stat('Regressões', r.summary.regressions, r.summary.regressions ? 'bad' : ''), stat('Reais / simulados', r.summary.realExecutions)),
      card(h('div', { class: 'card-head' }, h('h2', null, 'Resultado atual')),
        r.results.length === 0 ? h('p', { class: 'muted' }, 'Nenhum teste executado neste projeto ainda.')
          : table(['Workflow', 'Teste', 'Engine', 'Status', 'Duração', 'Data'], r.results.map((e) => [e.workflowName, h('a', { href: `#/executions/${e.id}` }, e.testName), engineBadge(e.engine),
            h('span', { class: 'row-gap' }, statusBadge(e.status), e.regression ? badge('regressão', 'bad') : null), fmtMs(e.durationMs), fmtDate(e.startedAt)]))),
      card(h('div', { class: 'card-head' }, h('h2', null, 'Problemas identificados')),
        r.results.filter((e) => e.status !== 'passed').length === 0 ? h('p', { class: 'muted' }, 'Nenhum problema nos resultados atuais.')
          : h('ul', { class: 'plain' }, ...r.results.filter((e) => e.status !== 'passed').map((e) => h('li', null, statusBadge(e.status), ' ', h('a', { href: `#/executions/${e.id}` }, e.testName), h('span', { class: 'muted' }, ` — ${e.error ?? `${e.assertionsFailed} assertion(s) reprovada(s)`}`))))),
    ];
  });
}
