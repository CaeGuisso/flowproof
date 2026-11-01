import { get, post, setCsrf, setUnauthorizedHandler } from './api.ts';
import { clear, h, icon, logoMark } from './dom.ts';
import { renderAuth } from './pages/auth.ts';
import { dashboardPage } from './pages/dashboard.ts';
import { executionDetailPage, executionsPage } from './pages/executions.ts';
import { projectDetailPage, projectsPage } from './pages/projects.ts';
import { reportsPage } from './pages/reports.ts';
import { settingsPage } from './pages/settings.ts';
import { state } from './pages/shared.ts';
import { testEditorPage } from './pages/tests.ts';
import { workflowPage } from './pages/workflow.ts';
import type { Session } from './types.ts';
import { emptyState } from './ui.ts';

const app = document.getElementById('app') as HTMLElement;
const NAV = [
  { href: '/', label: 'Visão geral', icon: 'dashboard', match: /^\/$/ },
  { href: '/projects', label: 'Projetos', icon: 'folder', match: /^\/(projects|workflows|tests)/ },
  { href: '/executions', label: 'Execuções', icon: 'history', match: /^\/executions/ },
  { href: '/reports', label: 'Relatórios', icon: 'report', match: /^\/reports/ },
  { href: '/settings', label: 'Configurações', icon: 'settings', match: /^\/settings/ },
];

let main: HTMLElement | null = null;

function parseHash(): { path: string; query: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path = '/', qs = ''] = raw.split('?');
  return { path: path.length > 1 ? path.replace(/\/$/, '') : path, query: new URLSearchParams(qs) };
}

function shell(): void {
  clear(app);
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Menu principal' },
    h('a', { class: 'brand', href: '#/' }, logoMark(26), h('span', null, 'FlowProof')),
    h('nav', { class: 'nav' }, ...NAV.map((n) => h('a', { class: 'nav-item', href: `#${n.href}`, 'data-href': n.href }, icon(n.icon), n.label))),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'user' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, (state.user?.name ?? '?').slice(0, 1).toUpperCase()), h('div', null, h('strong', null, state.user?.name ?? ''), h('div', { class: 'muted small' }, state.user?.email ?? ''))),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => void post('/api/auth/logout').finally(() => { state.user = null; setCsrf(null); showAuth(); }) }, icon('logout', 16), 'Sair')));
  const top = h('div', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')), h('span', { class: 'brand' }, logoMark(22), h('span', null, 'FlowProof')));
  main = h('main', { class: 'main', id: 'main' });
  app.append(top, sidebar, h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }), main);
}

function route(): void {
  if (!state.user) return;
  if (!main || !main.isConnected) shell();
  const root = main as HTMLElement;
  document.body.classList.remove('nav-open');
  clear(root);
  const { path, query } = parseHash();
  for (const a of document.querySelectorAll<HTMLElement>('.nav-item')) a.classList.toggle('active', NAV.find((n) => n.href === a.dataset.href)?.match.test(path) ?? false);
  const seg = path.split('/').filter(Boolean);
  const [a, b, c, d] = seg;
  window.scrollTo(0, 0);
  if (seg.length === 0) return dashboardPage(root);
  if (a === 'projects' && !b) return projectsPage(root);
  if (a === 'projects' && b && !c) return projectDetailPage(root, b);
  if (a === 'workflows' && b && !c) return workflowPage(root, b);
  if (a === 'workflows' && b && c === 'tests' && d === 'new') return testEditorPage(root, { workflowId: b });
  if (a === 'tests' && b) return testEditorPage(root, { testId: b });
  if (a === 'executions' && !b) return executionsPage(root, query);
  if (a === 'executions' && b) return executionDetailPage(root, b);
  if (a === 'reports') return reportsPage(root, b ?? null);
  if (a === 'settings') return settingsPage(root);
  root.appendChild(emptyState({ icon: 'info', title: 'Página não encontrada', text: 'O endereço não existe.', action: h('a', { class: 'btn', href: '#/' }, 'Ir para a visão geral') }));
}

function showAuth(): void {
  main = null;
  document.body.classList.remove('nav-open');
  renderAuth(app, () => { location.hash = '#/'; shell(); route(); });
}

async function boot(): Promise<void> {
  setUnauthorizedHandler(() => { if (state.user) { state.user = null; setCsrf(null); showAuth(); } });
  window.addEventListener('hashchange', route);
  try {
    const s = await get<Session>('/api/auth/me');
    state.user = s.user; state.registrationOpen = s.registrationOpen; setCsrf(s.csrf);
  } catch {
    clear(app);
    app.appendChild(emptyState({ icon: 'alert', title: 'Servidor indisponível', text: 'Não foi possível conectar ao FlowProof. Tente recarregar a página.' }));
    return;
  }
  if (state.user) { shell(); route(); } else showAuth();
}

void boot();
