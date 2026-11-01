import { h } from '../dom.ts';
import { badge, table } from '../ui.ts';
import type { DiffEntry, GraphEdge, Json, WorkflowDiff } from '../types.ts';

export function compact(v: Json | undefined): string {
  if (v === undefined) return '—';
  const t = JSON.stringify(v);
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

const KIND: Record<DiffEntry['kind'], { label: string; tone: 'ok' | 'bad' | 'warn' }> = {
  added: { label: 'adicionado', tone: 'ok' }, removed: { label: 'removido', tone: 'bad' }, changed: { label: 'alterado', tone: 'warn' },
};

export function diffTable(entries: DiffEntry[]): HTMLElement {
  return table(['Campo', 'Mudança', 'Antes', 'Depois'], entries.map((d) => [
    h('code', null, d.path), badge(KIND[d.kind].label, KIND[d.kind].tone),
    h('code', { class: `diff-val${d.kind === 'added' ? ' empty' : ''}` }, compact(d.before)), h('code', { class: `diff-val${d.kind === 'removed' ? ' empty' : ''}` }, compact(d.after))]), 'table-diff');
}

const edgeLabel = (e: GraphEdge): string => `${e.from} → ${e.to}${e.type === 'main' ? '' : ` (${e.type})`}`;

export function workflowDiffView(d: WorkflowDiff): HTMLElement {
  if (!d.hasRelevantChanges && d.nodesMoved.length === 0) return h('p', { class: 'muted' }, 'As duas versões são equivalentes.');
  const section = (title: string, tone: 'ok' | 'bad' | 'warn', items: string[]): HTMLElement | null =>
    items.length === 0 ? null : h('div', { class: 'diff-section' }, h('h4', null, badge(String(items.length), tone), ` ${title}`), h('ul', { class: 'plain' }, ...items.map((i) => h('li', null, h('code', null, i)))));
  return h('div', { class: 'stack' },
    !d.hasRelevantChanges ? h('p', { class: 'muted' }, 'Sem mudanças funcionais: apenas a posição de nós foi alterada.') : null,
    section('Nós adicionados', 'ok', d.nodesAdded), section('Nós removidos', 'bad', d.nodesRemoved),
    section('Conexões adicionadas', 'ok', d.edgesAdded.map(edgeLabel)), section('Conexões removidas', 'bad', d.edgesRemoved.map(edgeLabel)),
    ...d.nodesChanged.map((n) => h('div', { class: 'diff-section' }, h('h4', null, badge('alterado', 'warn'), ' ', h('code', null, n.name)), diffTable(n.changes))),
    d.nodesMoved.length > 0 ? h('p', { class: 'muted small' }, `${d.nodesMoved.length} nó(s) apenas reposicionado(s) — não considerado mudança relevante.`) : null);
}
