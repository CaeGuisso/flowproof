import { get } from '../api.ts';
import { h } from '../dom.ts';
import type { EngineInfo, EngineKind, Settings, User } from '../types.ts';
import { ENGINE_LABEL } from '../ui.ts';

export const state: { user: User | null; registrationOpen: boolean } = { user: null, registrationOpen: true };

let engines: EngineInfo[] | null = null;
export async function getEngines(): Promise<EngineInfo[]> {
  if (!engines) engines = (await get<Settings>('/api/settings')).engines;
  return engines;
}

export const go = (path: string): void => { location.hash = `#${path}`; };

/** Seletor de engine; opções indisponíveis ficam desabilitadas com o motivo. */
export function engineSelect(list: EngineInfo[], value: EngineKind = 'simulated'): HTMLSelectElement {
  const sel = h('select', { class: 'select', 'aria-label': 'Engine de execução' });
  for (const e of list) {
    const o = h('option', { value: e.id, ...(e.available ? {} : { disabled: true }), title: e.reason ?? e.description }, `${ENGINE_LABEL[e.id]}${e.available ? '' : ' (indisponível)'}`);
    sel.appendChild(o);
  }
  sel.value = value;
  return sel;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
