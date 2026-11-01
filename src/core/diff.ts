import { jsonType } from './paths.ts';
import type { DiffEntry, Json } from './types.ts';

const MAX_ENTRIES = 500;

function join(base: string, seg: string | number): string {
  if (typeof seg === 'number') return `${base}[${seg}]`;
  const plain = /^[A-Za-z_$][\w$-]*$/.test(seg);
  if (!plain) return `${base}["${seg}"]`;
  return base === '' ? seg : `${base}.${seg}`;
}

export function diffJson(before: Json | undefined, after: Json | undefined, limit = MAX_ENTRIES): DiffEntry[] {
  const out: DiffEntry[] = [];
  const walk = (a: Json | undefined, b: Json | undefined, path: string): void => {
    if (out.length >= limit) return;
    const label = path === '' ? '(raiz)' : path;
    if (a === undefined && b === undefined) return;
    if (a === undefined) return void out.push({ path: label, kind: 'added', after: b as Json });
    if (b === undefined) return void out.push({ path: label, kind: 'removed', before: a });
    const ta = jsonType(a);
    const tb = jsonType(b);
    if (ta !== tb) return void out.push({ path: label, kind: 'changed', before: a, after: b });
    if (ta === 'array') {
      const x = a as Json[];
      const y = b as Json[];
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) walk(x[i], y[i], join(path, i));
    } else if (ta === 'object') {
      const x = a as Record<string, Json>;
      const y = b as Record<string, Json>;
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of [...keys].sort()) {
        walk(Object.hasOwn(x, k) ? x[k] : undefined, Object.hasOwn(y, k) ? y[k] : undefined, join(path, k));
      }
    } else if (a !== b) {
      out.push({ path: label, kind: 'changed', before: a, after: b });
    }
  };
  walk(before, after, '');
  return out;
}
