import { ApiError } from './api.ts';
import { clear, h, icon, pretty } from './dom.ts';
import type { Child } from './dom.ts';
import type { EngineKind, ExecStatus } from './types.ts';

export function toast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' });
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${kind}` }, icon(kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'info', 16), h('span', null, message));
  host.appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 250); }, kind === 'error' ? 6000 : 3500);
}

export const errMsg = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : 'Erro inesperado.');

export interface ModalHandle { close: () => void; el: HTMLElement }

export function openModal(title: string, body: Node, opts: { wide?: boolean; footer?: Node; onClose?: () => void } = {}): ModalHandle {
  const previous = document.activeElement as HTMLElement | null;
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    previous?.focus();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const dialog = h('div', { class: `modal${opts.wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    opts.footer ? h('div', { class: 'modal-foot' }, opts.footer) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e: Event) => { if (e.target === overlay) close(); } }, dialog);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  const first = dialog.querySelector<HTMLElement>('input, textarea, select, button.btn');
  (first ?? dialog).focus();
  return { close, el: dialog };
}

export function confirmDialog(o: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean): void => { if (!done) { done = true; resolve(v); } m.close(); };
    const m = openModal(o.title, h('p', { class: 'muted' }, o.message), {
      onClose: () => { if (!done) { done = true; resolve(false); } },
      footer: h('div', { class: 'row-end' },
        h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancelar'),
        h('button', { class: `btn ${o.danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => finish(true) }, o.confirmLabel)),
    });
  });
}

/** Exige digitar o nome do recurso; resolve com o nome digitado ou null. */
export function typedConfirm(o: { title: string; message: string; name: string; confirmLabel: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', 'aria-label': 'Confirmação', placeholder: o.name });
    const ok = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, o.confirmLabel);
    const finish = (v: string | null): void => { if (!done) { done = true; resolve(v); } m.close(); };
    input.addEventListener('input', () => { ok.disabled = input.value !== o.name; });
    ok.addEventListener('click', () => finish(input.value));
    const m = openModal(o.title, h('div', { class: 'stack' }, h('p', { class: 'muted' }, o.message), h('p', null, 'Digite ', h('code', null, o.name), ' para confirmar.'), input), {
      onClose: () => { if (!done) { done = true; resolve(null); } },
      footer: h('div', { class: 'row-end' }, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Cancelar'), ok),
    });
  });
}

export function badge(text: string, kind: 'ok' | 'bad' | 'warn' | 'info' | 'muted' | 'accent' = 'muted', title?: string): HTMLElement {
  return h('span', { class: `badge badge-${kind}`, ...(title ? { title } : {}) }, text);
}

export const STATUS_LABEL: Record<ExecStatus, string> = { passed: 'Aprovado', failed: 'Reprovado', error: 'Erro' };
export const statusBadge = (s: ExecStatus | null): HTMLElement =>
  s === null ? badge('Sem execuções', 'muted') : badge(STATUS_LABEL[s], s === 'passed' ? 'ok' : s === 'failed' ? 'bad' : 'warn');

export const ENGINE_LABEL: Record<EngineKind, string> = { simulated: 'Simulada', real_local: 'Real local', real_container: 'Real em contêiner' };
export const engineBadge = (e: EngineKind): HTMLElement =>
  badge(ENGINE_LABEL[e], e === 'simulated' ? 'info' : 'accent', e === 'simulated' ? 'Execução simulada: não foi executada pelo n8n.' : 'Execução real pelo n8n.');

export function emptyState(o: { icon: string; title: string; text: string; action?: Node }): HTMLElement {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(o.icon, 26)), h('h3', null, o.title), h('p', { class: 'muted' }, o.text), o.action ?? null);
}

export const spinner = (label = 'Carregando…'): HTMLElement => h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spin' }), h('span', null, label));

export const errorBox = (message: string): HTMLElement => h('div', { class: 'alert alert-bad', role: 'alert' }, icon('alert', 16), h('span', null, message));
export const noteBox = (kind: 'info' | 'warn', ...children: Child[]): HTMLElement =>
  h('div', { class: `alert alert-${kind}` }, icon(kind === 'warn' ? 'alert' : 'info', 16), h('div', null, ...children));

export const card = (...children: Child[]): HTMLElement => h('section', { class: 'card' }, ...children);
export const jsonBlock = (v: unknown, cls = ''): HTMLElement => h('pre', { class: `code ${cls}`.trim() }, pretty(v));

export function pageHeader(title: string, subtitle?: Child, actions?: Node | null, crumbs?: Node | null): HTMLElement {
  return h('header', { class: 'page-head' },
    h('div', null, crumbs ?? null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    actions ? h('div', { class: 'page-actions' }, actions) : null);
}

export interface FormField { el: HTMLElement; setError: (m: string | undefined) => void }
export function formField(label: string, control: HTMLElement, hint?: string): FormField {
  const err = h('div', { class: 'field-error', role: 'alert' });
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  const el = h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null, err);
  return { el, setError: (m) => { err.textContent = m ?? ''; control.classList.toggle('invalid', Boolean(m)); control.setAttribute('aria-invalid', m ? 'true' : 'false'); } };
}

export function tabs(items: { id: string; label: string }[], active: string, onChange: (id: string) => void): HTMLElement {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const t of items) {
    bar.appendChild(h('button', { class: `tab${t.id === active ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.id === active), onclick: () => onChange(t.id) }, t.label));
  }
  return bar;
}

/** Mostra spinner, executa o render assíncrono e trata erros. */
export async function loadInto(container: HTMLElement, render: () => Promise<Node | Node[]>): Promise<void> {
  clear(container);
  container.appendChild(spinner());
  try {
    const out = await render();
    clear(container);
    for (const n of Array.isArray(out) ? out : [out]) container.appendChild(n);
  } catch (e) {
    clear(container);
    container.appendChild(e instanceof ApiError && e.status === 404
      ? emptyState({ icon: 'info', title: 'Não encontrado', text: 'Este item não existe ou foi removido.', action: h('a', { class: 'btn', href: '#/' }, 'Voltar ao início') })
      : errorBox(errMsg(e)));
  }
}

export function table(headers: string[], rows: Child[][], cls = ''): HTMLElement {
  return h('div', { class: 'table-wrap' }, h('table', { class: `table ${cls}`.trim() },
    h('thead', null, h('tr', null, ...headers.map((t) => h('th', null, t)))),
    h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c) => h('td', null, c)))))));
}

export function button(label: string, opts: { kind?: 'primary' | 'danger' | 'ghost' | ''; icon?: string; onClick?: (b: HTMLButtonElement) => void | Promise<void>; title?: string; type?: 'button' | 'submit' } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn${opts.kind ? ` btn-${opts.kind}` : ''}`, type: opts.type ?? 'button', ...(opts.title ? { title: opts.title } : {}) }, opts.icon ? icon(opts.icon, 16) : null, label);
  if (opts.onClick) {
    const fn = opts.onClick;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve(fn(b)).finally(() => { b.disabled = false; });
    });
  }
  return b;
}
