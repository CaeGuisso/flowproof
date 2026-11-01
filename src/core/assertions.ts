import { deepEqual, getPath, jsonType, parsePath, PathError, preview } from './paths.ts';
import { ASSERTION_OPS, JSON_TYPES } from './types.ts';
import type { Assertion, AssertionOp, AssertionResult, Json, JsonType } from './types.ts';

export const MAX_ASSERTIONS = 100;

/** Valida a forma de uma assertion; retorna mensagens de erro (vazio = válida). */
export function validateAssertion(a: unknown): string[] {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return ['Assertion deve ser um objeto.'];
  const { path, op, expected } = a as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof path !== 'string' || path.trim() === '' || path.length > 300) {
    errors.push('Caminho obrigatório (até 300 caracteres).');
  } else {
    try {
      parsePath(path);
    } catch (e) {
      errors.push(e instanceof PathError ? e.message : 'Caminho inválido.');
    }
  }
  if (typeof op !== 'string' || !(ASSERTION_OPS as readonly string[]).includes(op)) {
    errors.push(`Operador inválido. Use: ${ASSERTION_OPS.join(', ')}.`);
    return errors;
  }
  if (op === 'type' && !(typeof expected === 'string' && (JSON_TYPES as readonly string[]).includes(expected))) {
    errors.push(`Para "type", o valor esperado deve ser um de: ${JSON_TYPES.join(', ')}.`);
  }
  if (op === 'equals' && expected === undefined) errors.push('Para "equals", informe o valor esperado.');
  return errors;
}

export function normalizeAssertion(a: Assertion): Assertion {
  const out: Assertion = { path: a.path.trim(), op: a.op };
  if (a.op === 'equals' || a.op === 'type') out.expected = a.expected as Json;
  return out;
}

function isNotEmpty(v: Json): boolean {
  if (v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

export function evaluateAssertion(a: Assertion, root: Json): AssertionResult {
  const base = { path: a.path, op: a.op as AssertionOp, ...(a.expected !== undefined ? { expected: a.expected } : {}) };
  let found = false;
  let value: Json | undefined;
  try {
    const r = getPath(root, parsePath(a.path));
    found = r.found;
    value = r.value;
  } catch (e) {
    return { ...base, found: false, passed: false, message: e instanceof Error ? e.message : 'Caminho inválido.' };
  }
  const actual = found ? { actual: preview(value as Json) } : {};
  const res = (passed: boolean, message: string): AssertionResult => ({ ...base, found, ...actual, passed, message });
  switch (a.op) {
    case 'exists':
      return res(found, found ? 'O caminho existe.' : 'O caminho não existe.');
    case 'absent':
      return res(!found, found ? 'O caminho existe, mas deveria estar ausente.' : 'O caminho está ausente.');
    case 'equals': {
      if (!found) return res(false, 'O caminho não existe.');
      const ok = deepEqual(value as Json, a.expected as Json);
      return res(ok, ok ? 'Valor igual ao esperado.' : 'Valor diferente do esperado.');
    }
    case 'type': {
      if (!found) return res(false, 'O caminho não existe.');
      const t: JsonType = jsonType(value as Json);
      return res(t === a.expected, t === a.expected ? `Tipo ${t}.` : `Tipo ${t}, esperado ${String(a.expected)}.`);
    }
    case 'notEmpty': {
      if (!found) return res(false, 'O caminho não existe.');
      const ok = isNotEmpty(value as Json);
      return res(ok, ok ? 'Valor não está vazio.' : 'Valor vazio.');
    }
  }
}

export function runAssertions(assertions: Assertion[], root: Json): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, root));
}
