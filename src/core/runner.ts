import { runAssertions } from './assertions.ts';
import { getEngine } from './engines/index.ts';
import type { Assertion, AssertionResult, DataRoot, EngineKind, Fixture, Json, JsonObject, TraceEntry } from './types.ts';

export interface RunInput {
  engine: EngineKind;
  workflow: JsonObject;
  fixture: Fixture;
  assertions: Assertion[];
  targetNode?: string | null;
}

export interface RunOutcome {
  status: 'passed' | 'failed' | 'error';
  durationMs: number;
  assertionResults: AssertionResult[];
  passed: number;
  failed: number;
  error?: string;
  errorNode?: string;
  trace: TraceEntry[];
  data: DataRoot | null;
}

export async function runTestCase(input: RunInput): Promise<RunOutcome> {
  const start = performance.now();
  const engine = getEngine(input.engine);
  const result = await engine.run({ workflow: input.workflow, fixture: input.fixture, targetNode: input.targetNode ?? null });
  const durationMs = Math.round(performance.now() - start);
  if (result.status === 'error' || result.data === null) {
    return {
      status: 'error', durationMs, assertionResults: [], passed: 0, failed: 0,
      error: result.error ?? 'Erro de execução.', ...(result.errorNode ? { errorNode: result.errorNode } : {}),
      trace: result.trace, data: null,
    };
  }
  const assertionResults = runAssertions(input.assertions, result.data as unknown as Json);
  const failed = assertionResults.filter((r) => !r.passed).length;
  return {
    status: failed === 0 ? 'passed' : 'failed',
    durationMs, assertionResults, passed: assertionResults.length - failed, failed,
    trace: result.trace, data: result.data,
  };
}
