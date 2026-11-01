import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateAssertion, runAssertions, validateAssertion } from '../src/core/assertions.ts';
import { diffJson } from '../src/core/diff.ts';
import { getPath, parsePath, PathError } from '../src/core/paths.ts';
import { runTestCase } from '../src/core/runner.ts';
import { diffWorkflows, importWorkflow } from '../src/core/workflow.ts';
import { listEngines } from '../src/core/engines/index.ts';
import { toJUnit, xmlEscape } from '../src/core/report.ts';
import type { JsonObject } from '../src/core/types.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/sample-workflow.json', import.meta.url), 'utf8')) as unknown;

function imported(): JsonObject {
  const r = importWorkflow(raw);
  assert.ok(r.ok);
  return r.sanitized;
}

test('parsePath aceita pontos, índices e chaves entre aspas', () => {
  assert.deepEqual(parsePath('output[0].a.b'), ['output', 0, 'a', 'b']);
  assert.deepEqual(parsePath('$.nodes["Meu Nó"][1]'), ['nodes', 'Meu Nó', 1]);
  assert.deepEqual(parsePath('a.0.b'), ['a', 0, 'b']);
  assert.throws(() => parsePath(''), PathError);
  assert.throws(() => parsePath('a.__proto__'), PathError);
  assert.throws(() => parsePath('a[x]'), PathError);
});

test('getPath não atravessa o protótipo', () => {
  assert.equal(getPath({ a: 1 }, ['toString']).found, false);
  assert.equal(getPath({ a: [1, 2] }, ['a', 1]).value, 2);
  assert.equal(getPath({ a: [1] }, ['a', 5]).found, false);
});

test('assertions: exists, absent, equals, type, notEmpty', () => {
  const root = { output: [{ nome: 'Ana', tags: [], n: 3, nulo: null, obj: { x: 1 } }] };
  const ev = (path: string, op: 'exists' | 'absent' | 'equals' | 'type' | 'notEmpty', expected?: never) =>
    evaluateAssertion({ path, op, ...(expected !== undefined ? { expected } : {}) }, root).passed;
  assert.equal(ev('output[0].nome', 'exists'), true);
  assert.equal(ev('output[0].nulo', 'exists'), true);
  assert.equal(ev('output[0].x', 'exists'), false);
  assert.equal(ev('output[0].x', 'absent'), true);
  assert.equal(ev('output[0].nome', 'absent'), false);
  assert.equal(ev('output[0].n', 'equals', 3 as never), true);
  assert.equal(ev('output[0].n', 'equals', '3' as never), false);
  assert.equal(ev('output[0].obj', 'equals', { x: 1 } as never), true);
  assert.equal(ev('output[0].tags', 'type', 'array' as never), true);
  assert.equal(ev('output[0].nulo', 'type', 'null' as never), true);
  assert.equal(ev('output[0].tags', 'notEmpty'), false);
  assert.equal(ev('output[0].nulo', 'notEmpty'), false);
  assert.equal(ev('output[0].nome', 'notEmpty'), true);
  assert.equal(ev('output[0].n', 'notEmpty'), true);
});

test('validateAssertion rejeita operadores e valores inválidos', () => {
  assert.deepEqual(validateAssertion({ path: 'a', op: 'exists' }), []);
  assert.ok(validateAssertion({ path: 'a', op: 'type', expected: 'texto' }).length > 0);
  assert.ok(validateAssertion({ path: 'a', op: 'equals' }).length > 0);
  assert.ok(validateAssertion({ path: 'a', op: 'contains' }).length > 0);
  assert.ok(validateAssertion({ path: '', op: 'exists' }).length > 0);
  assert.ok(validateAssertion(null).length > 0);
});

test('diffJson identifica adicionados, removidos e alterados', () => {
  const d = diffJson({ a: 1, b: { c: 2 }, l: [1, 2] }, { a: 2, b: {}, d: 4, l: [1] });
  const byPath = Object.fromEntries(d.map((e) => [e.path, e.kind]));
  assert.equal(byPath.a, 'changed');
  assert.equal(byPath['b.c'], 'removed');
  assert.equal(byPath.d, 'added');
  assert.equal(byPath['l[1]'], 'removed');
  assert.deepEqual(diffJson({ a: 1 }, { a: 1 }), []);
});

test('importWorkflow sanitiza segredos, credenciais, pinData e e-mails', () => {
  const r = importWorkflow(raw);
  assert.ok(r.ok);
  const text = JSON.stringify(r.sanitized);
  for (const leak of ['super-secreta-123', 'abcdefghijklmnop123456', 'maria@cliente.com', '123.456.789-00', 'Slack da agencia', 'abc-123', 'deadbeef']) {
    assert.ok(!text.includes(leak), `vazou: ${leak}`);
  }
  assert.ok(text.includes('{{ $json.token }}'), 'expressões são preservadas, não avaliadas');
  assert.ok(text.includes('slackApi'));
  assert.ok(r.redactedPaths.length >= 4);
  assert.equal(r.summary.nodeCount, 4);
  assert.equal(r.summary.edgeCount, 3);
  assert.equal(r.summary.triggerCount, 1);
});

test('importWorkflow rejeita estruturas inválidas', () => {
  const bad = (x: unknown) => importWorkflow(x);
  assert.equal(bad(null).ok, false);
  assert.equal(bad([]).ok, false);
  assert.equal(bad({ nodes: 'x', connections: {} }).ok, false);
  assert.equal(bad({ nodes: [], connections: {} }).ok, false);
  assert.equal(bad({ nodes: [{ name: 'A', type: 'x.y' }, { name: 'A', type: 'x.y' }], connections: {} }).ok, false);
  assert.equal(bad({ nodes: [{ name: 'A', type: 'x.y' }], connections: { B: { main: [] } } }).ok, false);
  assert.equal(bad({ nodes: [{ name: 'A', type: 'x.y' }], connections: { A: { main: [[{ node: 'Z' }]] } } }).ok, false);
});

test('importWorkflow remove chaves de poluição de protótipo', () => {
  const evil = JSON.parse('{"nodes":[{"name":"A","type":"n8n-nodes-base.noOp","parameters":{"__proto__":{"x":1},"ok":true}}],"connections":{}}') as unknown;
  const r = importWorkflow(evil);
  assert.ok(r.ok);
  assert.ok(!JSON.stringify(r.sanitized).includes('__proto__'));
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('diffWorkflows detecta nós/conexões alterados e ignora posição como mudança relevante', () => {
  const a = imported();
  const b = structuredClone(a) as { nodes: Record<string, unknown>[]; connections: Record<string, unknown> };
  (b.nodes[1] as { parameters: { includeOtherFields: boolean } }).parameters.includeOtherFields = false;
  (b.nodes[0] as { position: number[] }).position = [5, 5];
  b.nodes.push({ name: 'Novo', type: 'n8n-nodes-base.noOp', position: [1, 1], parameters: {} });
  const d = diffWorkflows(a, b as unknown as JsonObject);
  assert.deepEqual(d.nodesAdded, ['Novo']);
  assert.equal(d.nodesChanged[0]?.name, 'Preparar');
  assert.deepEqual(d.nodesMoved, ['Webhook']);
  assert.equal(diffWorkflows(a, a).hasRelevantChanges, false);
});

test('engine simulada: Set literal + assertions; Slack exige mock', async () => {
  const wf = imported();
  const base = { engine: 'simulated' as const, workflow: wf, assertions: [{ path: 'output[0].status', op: 'equals' as const, expected: 'ativo' }] };
  const semMock = await runTestCase({ ...base, fixture: { input: { nome: 'Ana' } } });
  assert.equal(semMock.status, 'error');
  assert.match(semMock.error ?? '', /Enviar Slack/);
  const ok = await runTestCase({
    ...base,
    fixture: { input: { nome: 'Ana' }, mocks: { 'Enviar Slack': [{ ok: true }], HTTP: [{ id: 9 }] } },
    targetNode: 'Preparar',
    assertions: [
      { path: 'output[0].status', op: 'equals', expected: 'ativo' },
      { path: 'output[0].creditos', op: 'equals', expected: 10 },
      { path: 'output[0].nome', op: 'equals', expected: 'Ana' },
      { path: 'nodes["Enviar Slack"][0].ok', op: 'equals', expected: true },
    ],
  });
  assert.equal(ok.status, 'passed');
  assert.equal(ok.passed, 4);
  const falha = await runTestCase({
    ...base, fixture: { input: {}, mocks: { 'Enviar Slack': [{}], HTTP: [{}] } }, targetNode: 'Preparar',
    assertions: [{ path: 'output[0].status', op: 'equals', expected: 'inativo' }],
  });
  assert.equal(falha.status, 'failed');
  assert.equal(falha.failed, 1);
});

test('engine simulada: não avalia expressões e valida alvo', async () => {
  const w = importWorkflow({
    nodes: [
      { name: 'Start', type: 'n8n-nodes-base.manualTrigger', position: [0, 0] },
      { name: 'S', type: 'n8n-nodes-base.set', typeVersion: 3, position: [1, 1], parameters: { assignments: { assignments: [{ name: 'x', value: '={{ process.exit(1) }}', type: 'string' }] } } },
    ],
    connections: { Start: { main: [[{ node: 'S', type: 'main', index: 0 }]] } },
  });
  assert.ok(w.ok);
  const r = await runTestCase({ engine: 'simulated', workflow: w.sanitized, fixture: {}, assertions: [{ path: 'output', op: 'exists' }] });
  assert.equal(r.status, 'error');
  assert.match(r.error ?? '', /Expressão/);
  const t = await runTestCase({ engine: 'simulated', workflow: w.sanitized, fixture: {}, targetNode: 'Nope', assertions: [{ path: 'output', op: 'exists' }] });
  assert.match(t.error ?? '', /não existe/);
});

test('engines reais estão listadas como indisponíveis e não implementadas', async () => {
  const engines = listEngines({});
  assert.equal(engines.find((e) => e.id === 'simulated')?.realExecution, false);
  for (const id of ['real_local', 'real_container']) {
    const e = engines.find((x) => x.id === id);
    assert.equal(e?.available, false);
    assert.equal(e?.implemented, false);
    assert.equal(e?.realExecution, true);
  }
  await assert.rejects(runTestCase({ engine: 'real_local', workflow: imported(), fixture: {}, assertions: [] }));
});

test('runAssertions retorna um resultado por assertion', () => {
  assert.equal(runAssertions([{ path: 'a', op: 'exists' }, { path: 'b', op: 'absent' }], { a: 1 }).length, 2);
});

test('JUnit escapa XML e marca engine', () => {
  assert.equal(xmlEscape('a<b>&"\'\u0001'), 'a&lt;b&gt;&amp;&quot;&apos;');
  const xml = toJUnit([
    { project: 'P', workflow: 'W', test: 'T <1>', engine: 'simulated', realExecution: false, status: 'failed', durationMs: 12, message: 'x & y', startedAt: 'now' },
    { project: 'P', workflow: 'W', test: 'T2', engine: 'simulated', realExecution: false, status: 'passed', durationMs: 3, message: null, startedAt: 'now' },
  ], '2026-01-01T00:00:00Z');
  assert.match(xml, /tests="2" failures="1" errors="0"/);
  assert.match(xml, /name="T &lt;1&gt; \[simulated\]"/);
  assert.match(xml, /real_execution" value="false"/);
});
