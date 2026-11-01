import { HttpError } from './http.ts';
import { validateAssertion, MAX_ASSERTIONS, normalizeAssertion } from '../core/assertions.ts';
import type { Assertion, Fixture, Json, JsonObject } from '../core/types.ts';

export class Fields {
  readonly errors: Record<string, string> = {};

  str(body: JsonObject, key: string, opts: { min?: number; max: number; required?: boolean; label?: string }): string | undefined {
    const raw = body[key];
    const label = opts.label ?? key;
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.errors[key] = `${label} é obrigatório.`;
      return opts.required ? undefined : '';
    }
    if (typeof raw !== 'string') { this.errors[key] = `${label} deve ser texto.`; return undefined; }
    const v = raw.trim();
    if (v.length < (opts.min ?? (opts.required ? 1 : 0))) this.errors[key] = `${label} é obrigatório.`;
    else if (v.length > opts.max) this.errors[key] = `${label} deve ter no máximo ${opts.max} caracteres.`;
    else return v;
    return undefined;
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) {
      throw new HttpError(422, 'validation', 'Verifique os campos informados.', this.errors);
    }
  }
}

const MAX_FIXTURE_CHARS = 500_000;

export function parseFixture(raw: unknown, f: Fields): Fixture {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) { f.errors.fixture = 'A fixture deve ser um objeto.'; return {}; }
  if (JSON.stringify(raw).length > MAX_FIXTURE_CHARS) { f.errors.fixture = 'Fixture grande demais.'; return {}; }
  const obj = raw as Record<string, Json>;
  const out: Fixture = {};
  if (obj.input !== undefined) out.input = obj.input;
  if (obj.mocks !== undefined) {
    const m = obj.mocks;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      f.errors.fixture = '"mocks" deve ser um objeto {nome do nó: [itens]}.';
      return {};
    }
    const mocks: Record<string, Json[]> = {};
    for (const [k, v] of Object.entries(m)) {
      if (!Array.isArray(v)) { f.errors.fixture = `O mock de "${k}" deve ser uma lista de itens.`; return {}; }
      if (k === '__proto__') continue;
      mocks[k] = v;
    }
    out.mocks = mocks;
  }
  return out;
}

export function parseAssertions(raw: unknown, f: Fields): Assertion[] {
  if (!Array.isArray(raw) || raw.length === 0) { f.errors.assertions = 'Inclua ao menos uma assertion.'; return []; }
  if (raw.length > MAX_ASSERTIONS) { f.errors.assertions = `Máximo de ${MAX_ASSERTIONS} assertions.`; return []; }
  const out: Assertion[] = [];
  raw.forEach((a, i) => {
    const errs = validateAssertion(a);
    if (errs.length > 0) f.errors.assertions = `Assertion #${i + 1}: ${errs[0]}`;
    else out.push(normalizeAssertion(a as Assertion));
  });
  return out;
}
