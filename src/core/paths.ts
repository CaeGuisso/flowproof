import type { Json } from './types.ts';

export class PathError extends Error {}

export type Segment = string | number;

const MAX_SEGMENTS = 32;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Aceita: a.b[0].c, a.0.c, ["chave com.ponto"], prefixo "$" opcional. */
export function parsePath(input: string): Segment[] {
  let s = input.trim();
  if (s.startsWith('$')) s = s.slice(1);
  if (s.startsWith('.')) s = s.slice(1);
  if (s.length === 0) throw new PathError('O caminho não pode ser vazio.');
  const out: Segment[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') {
      const close = s.indexOf(']', i);
      if (close === -1) throw new PathError('Colchete não fechado no caminho.');
      const inner = s.slice(i + 1, close);
      if (/^\d+$/.test(inner)) out.push(Number(inner));
      else if (/^(["']).*\1$/.test(inner) && inner.length >= 2) out.push(inner.slice(1, -1));
      else throw new PathError(`Índice inválido: [${inner}]`);
      i = close + 1;
      if (s[i] === '.') i += 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== '.' && s[j] !== '[') j += 1;
      const key = s.slice(i, j);
      if (key.length === 0) throw new PathError('Segmento vazio no caminho.');
      out.push(/^\d+$/.test(key) ? Number(key) : key);
      i = j;
      if (s[i] === '.') i += 1;
    }
    if (out.length > MAX_SEGMENTS) throw new PathError('Caminho profundo demais.');
  }
  for (const seg of out) {
    if (typeof seg === 'string' && FORBIDDEN.has(seg)) throw new PathError(`Segmento não permitido: ${seg}`);
  }
  return out;
}

export function getPath(root: Json, segments: Segment[]): { found: boolean; value?: Json } {
  let cur: Json = root;
  for (const seg of segments) {
    if (Array.isArray(cur)) {
      if (typeof seg !== 'number' || seg >= cur.length) return { found: false };
      cur = cur[seg] as Json;
    } else if (cur !== null && typeof cur === 'object') {
      const key = String(seg);
      if (!Object.hasOwn(cur, key)) return { found: false };
      cur = (cur as Record<string, Json>)[key] as Json;
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

export function jsonType(v: Json): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as 'string' | 'number' | 'boolean' | 'object';
}

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  const ta = jsonType(a);
  if (ta !== jsonType(b)) return false;
  if (ta === 'array') {
    const x = a as Json[];
    const y = b as Json[];
    return x.length === y.length && x.every((v, i) => deepEqual(v, y[i] as Json));
  }
  if (ta === 'object') {
    const x = a as Record<string, Json>;
    const y = b as Record<string, Json>;
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    return kx.every((k) => Object.hasOwn(y, k) && deepEqual(x[k] as Json, y[k] as Json));
  }
  return false;
}

/** Limita o tamanho de valores guardados em resultados. */
export function preview(v: Json, maxChars = 1000): Json {
  const text = JSON.stringify(v);
  if (text.length <= maxChars) return v;
  return `[truncado: ${jsonType(v)}, ${text.length} caracteres] ${text.slice(0, 200)}…`;
}
