export type Child = Node | string | number | null | undefined | false;
export type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'innerHTML' || k === 'outerHTML') throw new Error('HTML bruto não é permitido.');
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  flow: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M9 6h4a3 3 0 0 1 3 3v6',
  flask: 'M9 3h6 M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3',
  play: 'M7 4l13 8-13 8z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2',
  report: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h6 M9 17h6',
  settings: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M14 4v4 M10 10v4 M16 16v4',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  download: 'M12 4v12 M7 11l5 5 5-5 M5 20h14',
  upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
  alert: 'M12 3L2 20h20z M12 10v4 M12 17h0',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12 M18 6L6 18',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h0',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
};

export function icon(name: keyof typeof ICONS | string, size = 18): SVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' });
  s.appendChild(svg('path', { d: ICONS[name] ?? ICONS.info ?? '' }));
  return s;
}

export function logoMark(size = 26): SVGElement {
  const s = svg('svg', { viewBox: '0 0 32 32', width: size, height: size, 'aria-hidden': 'true' });
  s.appendChild(svg('rect', { x: 1, y: 1, width: 30, height: 30, rx: 8, fill: '#0f1a2b', stroke: '#22d3ee', 'stroke-opacity': 0.5 }));
  s.appendChild(svg('path', { d: 'M7 21c4 0 4-10 9-10s4 10 9 10', fill: 'none', stroke: '#3b82f6', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
  s.appendChild(svg('path', { d: 'M12.5 16.5l2.5 2.5 5-6', fill: 'none', stroke: '#22d3ee', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const fmtDate = (iso: string | null | undefined): string => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtMs = (ms: number | null | undefined): string => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
export function fmtAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
export const pretty = (v: unknown): string => {
  const t = JSON.stringify(v, null, 2);
  return t === undefined ? 'undefined' : t;
};
