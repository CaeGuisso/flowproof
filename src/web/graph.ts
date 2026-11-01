import { h, svg } from './dom.ts';
import { jsonBlock } from './ui.ts';
import type { GraphEdge, GraphNode } from './types.ts';

const W = 168;
const H = 46;
const PAD = 40;

export function workflowGraph(nodes: GraphNode[], edges: GraphEdge[], params: (name: string) => unknown): HTMLElement {
  const xs = nodes.map((n) => n.position[0]);
  const ys = nodes.map((n) => n.position[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + W + PAD * 2;
  const height = Math.max(...ys) - minY + H + PAD * 2;
  const pos = new Map(nodes.map((n) => [n.name, { x: n.position[0] - minX + PAD, y: n.position[1] - minY + PAD }]));
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `Grafo do workflow com ${nodes.length} nós`, class: 'graph' });
  const defs = svg('defs');
  const marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  marker.appendChild(svg('path', { d: 'M0 0L10 5L0 10z', class: 'graph-arrow' }));
  defs.appendChild(marker);
  root.appendChild(defs);

  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + W;
    const y1 = a.y + H / 2;
    const x2 = b.x;
    const y2 = b.y + H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    root.appendChild(svg('path', {
      d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`, class: `graph-edge${e.type === 'main' ? '' : ' graph-edge-aux'}`, 'marker-end': 'url(#arrow)',
    }));
  }

  const detail = h('div', { class: 'graph-detail muted' }, 'Clique em um nó para ver seus parâmetros (credenciais e segredos já foram removidos).');
  const nodeEls = new Map<string, SVGElement>();
  for (const n of nodes) {
    const p = pos.get(n.name) as { x: number; y: number };
    const trigger = /trigger$|\.webhook$/i.test(n.type);
    const g = svg('g', { class: `graph-node${trigger ? ' graph-trigger' : ''}${n.disabled ? ' graph-disabled' : ''}`, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${n.name}, ${n.type}` });
    g.appendChild(svg('title', {}, `${n.name}\n${n.type}`));
    g.appendChild(svg('rect', { width: W, height: H, rx: 7 }));
    const short = (s: string, k: number): string => (s.length > k ? `${s.slice(0, k - 1)}…` : s);
    g.appendChild(svg('text', { x: 12, y: 20, class: 'graph-name' }, short(n.name, 22)));
    g.appendChild(svg('text', { x: 12, y: 36, class: 'graph-type' }, short(n.type.replace('n8n-nodes-base.', ''), 26)));
    const select = (): void => {
      for (const el of nodeEls.values()) el.classList.remove('selected');
      g.classList.add('selected');
      const parts: Node[] = [
        h('div', { class: 'row-between' }, h('strong', null, n.name), h('span', { class: 'muted mono' }, `${n.type}${n.typeVersion ? ` v${n.typeVersion}` : ''}`)),
      ];
      if (n.credentialTypes.length > 0) parts.push(h('p', { class: 'muted' }, `Credenciais usadas (valores removidos): ${n.credentialTypes.join(', ')}`));
      parts.push(jsonBlock(params(n.name)));
      detail.replaceChildren(...parts);
      detail.classList.remove('muted');
    };
    g.addEventListener('click', select);
    g.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') { ev.preventDefault(); select(); } });
    nodeEls.set(n.name, g);
    root.appendChild(g);
  }
  return h('div', { class: 'graph-wrap' }, h('div', { class: 'graph-scroll' }, root), detail);
}
