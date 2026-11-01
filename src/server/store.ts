import { randomUUID } from 'node:crypto';
import { diffJson } from '../core/diff.ts';
import { getEngine, listEngines } from '../core/engines/index.ts';
import { runTestCase } from '../core/runner.ts';
import { toJUnit } from '../core/report.ts';
import type { ReportCase } from '../core/report.ts';
import { diffWorkflows, importWorkflow, summarizeWorkflow } from '../core/workflow.ts';
import { ENGINE_KINDS } from '../core/types.ts';
import type { Assertion, DiffEntry, EngineKind, Fixture, Json, JsonObject } from '../core/types.ts';
import type { Db } from './db.ts';
import { HttpError, notFound } from './http.ts';
import { sha256 } from './security.ts';
import { Fields, parseAssertions, parseFixture } from './validate.ts';
import { EXAMPLE_TESTS, EXAMPLE_WORKFLOW } from './examples.ts';

const now = (): string => new Date().toISOString();
const parse = <T>(s: unknown): T => JSON.parse(String(s)) as T;
const MAX_OUTPUT_CHARS = 200_000;

export function audit(db: Db, userId: string, action: string, entity: string, entityId: string | null, label: string | null): void {
  db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId, action, entity, entityId, label, now());
}

/* ---------- Projetos ---------- */

interface ProjectRow { id: string; user_id: string; name: string; client: string; description: string; created_at: string; updated_at: string }

export function ownedProject(db: Db, userId: string, id: string): ProjectRow {
  const row = db.get<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Projeto');
  return row;
}

function projectStats(db: Db, p: ProjectRow) {
  const wf = db.get<{ n: number }>('SELECT COUNT(*) n FROM workflows WHERE project_id = ?', p.id)?.n ?? 0;
  const tests = db.get<{ n: number }>('SELECT COUNT(*) n FROM test_cases t JOIN workflows w ON w.id = t.workflow_id WHERE w.project_id = ?', p.id)?.n ?? 0;
  const latest = db.all<{ status: string }>(
    `SELECT e.status FROM executions e WHERE e.project_id = ? AND e.test_case_id IS NOT NULL AND e.started_at = (
       SELECT MAX(x.started_at) FROM executions x WHERE x.test_case_id = e.test_case_id)`, p.id);
  const execs = db.get<{ n: number; last: string | null }>('SELECT COUNT(*) n, MAX(started_at) last FROM executions WHERE project_id = ?', p.id);
  const passing = latest.filter((l) => l.status === 'passed').length;
  return {
    workflows: wf, tests, executions: execs?.n ?? 0, lastActivity: execs?.last ?? p.updated_at,
    testsWithResult: latest.length, testsPassing: passing,
    quality: latest.length > 0 ? Math.round((passing / latest.length) * 100) : null,
  };
}

const mapProject = (db: Db, p: ProjectRow) => ({
  id: p.id, name: p.name, client: p.client, description: p.description, createdAt: p.created_at, updatedAt: p.updated_at, stats: projectStats(db, p),
});

export const listProjects = (db: Db, userId: string) =>
  db.all<ProjectRow>('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', userId).map((p) => mapProject(db, p));

export const getProject = (db: Db, userId: string, id: string) => mapProject(db, ownedProject(db, userId, id));

function projectInput(body: JsonObject) {
  const f = new Fields();
  const name = f.str(body, 'name', { max: 100, required: true, label: 'Nome' });
  const client = f.str(body, 'client', { max: 100, label: 'Cliente' });
  const description = f.str(body, 'description', { max: 1000, label: 'Descrição' });
  f.done();
  return { name: name as string, client: client ?? '', description: description ?? '' };
}

export function createProject(db: Db, userId: string, body: JsonObject) {
  const v = projectInput(body);
  const id = randomUUID();
  const t = now();
  db.run('INSERT INTO projects (id, user_id, name, client, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, userId, v.name, v.client, v.description, t, t);
  audit(db, userId, 'created', 'project', id, v.name);
  return getProject(db, userId, id);
}

export function updateProject(db: Db, userId: string, id: string, body: JsonObject) {
  ownedProject(db, userId, id);
  const v = projectInput(body);
  db.run('UPDATE projects SET name = ?, client = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?', v.name, v.client, v.description, now(), id, userId);
  audit(db, userId, 'updated', 'project', id, v.name);
  return getProject(db, userId, id);
}

export function confirmDeletion(body: JsonObject, name: string): void {
  if (body.confirmName !== name) {
    throw new HttpError(422, 'validation', 'Digite o nome exato para confirmar a exclusão.', { confirmName: 'O nome não confere.' });
  }
}

export function deleteProject(db: Db, userId: string, id: string, body: JsonObject): void {
  const p = ownedProject(db, userId, id);
  confirmDeletion(body, p.name);
  db.run('DELETE FROM projects WHERE id = ? AND user_id = ?', id, userId);
  audit(db, userId, 'deleted', 'project', id, p.name);
}

/* ---------- Workflows ---------- */

interface WorkflowRow { id: string; project_id: string; name: string; is_example: number; created_at: string; updated_at: string }
interface VersionRow { id: string; workflow_id: string; version: number; content: string; content_hash: string; node_count: number; redaction_count: number; warnings: string; created_at: string }

export function ownedWorkflow(db: Db, userId: string, id: string): WorkflowRow {
  const row = db.get<WorkflowRow>('SELECT w.* FROM workflows w JOIN projects p ON p.id = w.project_id WHERE w.id = ? AND p.user_id = ?', id, userId);
  if (!row) throw notFound('Workflow');
  return row;
}

const latestVersion = (db: Db, workflowId: string): VersionRow =>
  db.get<VersionRow>('SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1', workflowId) as VersionRow;

const versionMeta = (v: VersionRow) => ({
  id: v.id, version: v.version, nodeCount: v.node_count, redactionCount: v.redaction_count,
  warnings: parse<string[]>(v.warnings), contentHash: v.content_hash, createdAt: v.created_at,
});

function insertVersion(db: Db, workflowId: string, raw: unknown, fallbackName?: string): { version: VersionRow; sanitized: JsonObject; unchanged: boolean } {
  const r = importWorkflow(raw, fallbackName);
  if (!r.ok) throw new HttpError(422, 'invalid_workflow', 'O workflow é inválido.', { workflow: r.errors.join(' ') });
  const content = JSON.stringify(r.sanitized);
  const hash = sha256(content);
  const prev = db.get<VersionRow>('SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1', workflowId);
  if (prev && prev.content_hash === hash) return { version: prev, sanitized: r.sanitized, unchanged: true };
  const id = randomUUID();
  const num = (prev?.version ?? 0) + 1;
  db.run(
    'INSERT INTO workflow_versions (id, workflow_id, version, content, content_hash, node_count, redaction_count, warnings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, workflowId, num, content, hash, r.summary.nodeCount, r.redactedPaths.length, JSON.stringify(r.warnings), now(),
  );
  return { version: db.get<VersionRow>('SELECT * FROM workflow_versions WHERE id = ?', id) as VersionRow, sanitized: r.sanitized, unchanged: false };
}

export function importIntoProject(db: Db, userId: string, projectId: string, body: JsonObject, opts: { example?: boolean } = {}) {
  ownedProject(db, userId, projectId);
  const raw = body.workflow;
  if (raw === undefined) throw new HttpError(422, 'validation', 'Envie o JSON do workflow no campo "workflow".', { workflow: 'Obrigatório.' });
  const f = new Fields();
  const customName = f.str(body, 'name', { max: 150, label: 'Nome' });
  f.done();
  const id = randomUUID();
  const t = now();
  return db.tx(() => {
    const probe = importWorkflow(raw);
    if (!probe.ok) throw new HttpError(422, 'invalid_workflow', 'O workflow é inválido.', { workflow: probe.errors.join(' ') });
    const name = customName || String(probe.sanitized.name);
    db.run('INSERT INTO workflows (id, project_id, name, is_example, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, projectId, name, opts.example ? 1 : 0, t, t);
    insertVersion(db, id, raw, name);
    db.run('UPDATE projects SET updated_at = ? WHERE id = ?', t, projectId);
    audit(db, userId, 'imported', 'workflow', id, name);
    return getWorkflow(db, userId, id);
  });
}

export function addExample(db: Db, userId: string, projectId: string) {
  const wf = importIntoProject(db, userId, projectId, { workflow: EXAMPLE_WORKFLOW as Json }, { example: true });
  for (const t of EXAMPLE_TESTS) {
    createTest(db, userId, wf.id, { name: t.name, description: t.description, fixture: t.fixture as Json, assertions: t.assertions as unknown as Json, targetNode: t.targetNode });
  }
  return getWorkflow(db, userId, wf.id);
}

export function listWorkflows(db: Db, userId: string, projectId: string) {
  ownedProject(db, userId, projectId);
  return db.all<WorkflowRow>('SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC', projectId).map((w) => {
    const v = latestVersion(db, w.id);
    const tests = db.get<{ n: number }>('SELECT COUNT(*) n FROM test_cases WHERE workflow_id = ?', w.id)?.n ?? 0;
    const last = db.get<{ status: string; started_at: string }>('SELECT status, started_at FROM executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 1', w.id);
    return {
      id: w.id, projectId: w.project_id, name: w.name, isExample: w.is_example === 1, version: v.version, nodeCount: v.node_count,
      tests, lastStatus: last?.status ?? null, lastRunAt: last?.started_at ?? null, updatedAt: w.updated_at,
    };
  });
}

export function getWorkflow(db: Db, userId: string, id: string) {
  const w = ownedWorkflow(db, userId, id);
  const v = latestVersion(db, id);
  const project = db.get<{ name: string }>('SELECT name FROM projects WHERE id = ?', w.project_id);
  const content = parse<JsonObject>(v.content);
  return {
    id: w.id, projectId: w.project_id, projectName: project?.name ?? '', name: w.name, isExample: w.is_example === 1,
    createdAt: w.created_at, updatedAt: w.updated_at, current: versionMeta(v), summary: summarizeWorkflow(content),
    versions: db.all<VersionRow>('SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC', id).map(versionMeta),
  };
}

export function addVersion(db: Db, userId: string, id: string, body: JsonObject) {
  const w = ownedWorkflow(db, userId, id);
  if (body.workflow === undefined) throw new HttpError(422, 'validation', 'Envie o JSON do workflow no campo "workflow".', { workflow: 'Obrigatório.' });
  return db.tx(() => {
    const r = insertVersion(db, id, body.workflow, w.name);
    if (!r.unchanged) {
      db.run('UPDATE workflows SET updated_at = ? WHERE id = ?', now(), id);
      audit(db, userId, 'new_version', 'workflow', id, `${w.name} v${r.version.version}`);
    }
    return { unchanged: r.unchanged, workflow: getWorkflow(db, userId, id) };
  });
}

function versionOf(db: Db, workflowId: string, ref: string | null): VersionRow {
  const row = ref === null
    ? latestVersion(db, workflowId)
    : db.get<VersionRow>('SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?', workflowId, Number(ref));
  if (!row) throw notFound('Versão');
  return row;
}

export function workflowVersionContent(db: Db, userId: string, id: string, ref: string | null) {
  ownedWorkflow(db, userId, id);
  const v = versionOf(db, id, ref);
  const content = parse<JsonObject>(v.content);
  return { version: versionMeta(v), content, summary: summarizeWorkflow(content) };
}

export function compareVersions(db: Db, userId: string, id: string, from: string | null, to: string | null) {
  ownedWorkflow(db, userId, id);
  const a = versionOf(db, id, from);
  const b = versionOf(db, id, to);
  return { from: versionMeta(a), to: versionMeta(b), diff: diffWorkflows(parse<JsonObject>(a.content), parse<JsonObject>(b.content)) };
}

export function exportWorkflow(db: Db, userId: string, id: string, ref: string | null) {
  const w = ownedWorkflow(db, userId, id);
  const v = versionOf(db, id, ref);
  audit(db, userId, 'exported', 'workflow', id, `${w.name} v${v.version}`);
  return { filename: `${w.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'workflow'}-v${v.version}.json`, body: JSON.stringify(parse<JsonObject>(v.content), null, 2) };
}

export function deleteWorkflow(db: Db, userId: string, id: string, body: JsonObject): void {
  const w = ownedWorkflow(db, userId, id);
  confirmDeletion(body, w.name);
  db.run('DELETE FROM workflows WHERE id = ?', id);
  audit(db, userId, 'deleted', 'workflow', id, w.name);
}

/* ---------- Casos de teste ---------- */

interface TestRow { id: string; workflow_id: string; name: string; description: string; fixture: string; assertions: string; target_node: string | null; status: 'active' | 'disabled'; created_at: string; updated_at: string }

function ownedTest(db: Db, userId: string, id: string): TestRow {
  const row = db.get<TestRow>(
    'SELECT t.* FROM test_cases t JOIN workflows w ON w.id = t.workflow_id JOIN projects p ON p.id = w.project_id WHERE t.id = ? AND p.user_id = ?', id, userId);
  if (!row) throw notFound('Caso de teste');
  return row;
}

const mapTest = (db: Db, t: TestRow) => {
  const last = db.get<{ id: string; status: string; engine: string; started_at: string }>(
    'SELECT id, status, engine, started_at FROM executions WHERE test_case_id = ? ORDER BY started_at DESC LIMIT 1', t.id);
  return {
    id: t.id, workflowId: t.workflow_id, name: t.name, description: t.description, fixture: parse<Fixture>(t.fixture),
    assertions: parse<Assertion[]>(t.assertions), targetNode: t.target_node, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
    lastExecution: last ? { id: last.id, status: last.status, engine: last.engine, startedAt: last.started_at } : null,
  };
};

function testInput(db: Db, workflowId: string, body: JsonObject) {
  const f = new Fields();
  const name = f.str(body, 'name', { max: 150, required: true, label: 'Nome' });
  const description = f.str(body, 'description', { max: 1000, label: 'Descrição' });
  const fixture = parseFixture(body.fixture, f);
  const assertions = parseAssertions(body.assertions, f);
  const status = body.status === 'disabled' ? 'disabled' : 'active';
  let targetNode: string | null = null;
  if (typeof body.targetNode === 'string' && body.targetNode.trim() !== '') {
    const names = (parse<JsonObject>(latestVersion(db, workflowId).content).nodes as Record<string, Json>[]).map((n) => String(n.name));
    if (!names.includes(body.targetNode)) f.errors.targetNode = 'O nó alvo não existe neste workflow.';
    else targetNode = body.targetNode;
  }
  f.done();
  return { name: name as string, description: description ?? '', fixture, assertions, status, targetNode };
}

export function listTests(db: Db, userId: string, workflowId: string) {
  ownedWorkflow(db, userId, workflowId);
  return db.all<TestRow>('SELECT * FROM test_cases WHERE workflow_id = ? ORDER BY created_at ASC', workflowId).map((t) => mapTest(db, t));
}

export const getTest = (db: Db, userId: string, id: string) => mapTest(db, ownedTest(db, userId, id));

export function createTest(db: Db, userId: string, workflowId: string, body: JsonObject) {
  const w = ownedWorkflow(db, userId, workflowId);
  const v = testInput(db, workflowId, body);
  const id = randomUUID();
  const t = now();
  db.run(
    'INSERT INTO test_cases (id, workflow_id, name, description, fixture, assertions, target_node, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, workflowId, v.name, v.description, JSON.stringify(v.fixture), JSON.stringify(v.assertions), v.targetNode, v.status, t, t,
  );
  audit(db, userId, 'created', 'test', id, `${v.name} (${w.name})`);
  return getTest(db, userId, id);
}

export function updateTest(db: Db, userId: string, id: string, body: JsonObject) {
  const t = ownedTest(db, userId, id);
  const v = testInput(db, t.workflow_id, body);
  db.run('UPDATE test_cases SET name = ?, description = ?, fixture = ?, assertions = ?, target_node = ?, status = ?, updated_at = ? WHERE id = ?',
    v.name, v.description, JSON.stringify(v.fixture), JSON.stringify(v.assertions), v.targetNode, v.status, now(), id);
  audit(db, userId, 'updated', 'test', id, v.name);
  return getTest(db, userId, id);
}

export function duplicateTest(db: Db, userId: string, id: string) {
  const t = ownedTest(db, userId, id);
  const id2 = randomUUID();
  const ts = now();
  const name = `${t.name} (cópia)`.slice(0, 150);
  db.run(
    'INSERT INTO test_cases (id, workflow_id, name, description, fixture, assertions, target_node, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id2, t.workflow_id, name, t.description, t.fixture, t.assertions, t.target_node, t.status, ts, ts,
  );
  audit(db, userId, 'duplicated', 'test', id2, name);
  return getTest(db, userId, id2);
}

export function deleteTest(db: Db, userId: string, id: string): void {
  const t = ownedTest(db, userId, id);
  db.run('DELETE FROM test_cases WHERE id = ?', id);
  audit(db, userId, 'deleted', 'test', id, t.name);
}

/* ---------- Execuções ---------- */

export function parseEngine(v: unknown): EngineKind {
  if (typeof v !== 'string' || !(ENGINE_KINDS as readonly string[]).includes(v)) {
    throw new HttpError(422, 'validation', 'Engine inválida.', { engine: `Use: ${ENGINE_KINDS.join(', ')}.` });
  }
  return v as EngineKind;
}

interface ExecRow {
  id: string; user_id: string; project_id: string; workflow_id: string; workflow_version_id: string; test_case_id: string | null; test_name: string;
  engine: EngineKind; real_execution: number; status: 'passed' | 'failed' | 'error'; started_at: string; duration_ms: number | null;
  assertions_passed: number; assertions_failed: number; error: string | null; result: string; output: string | null; diff: string;
  baseline_execution_id: string | null; regression: number;
}

const mapExec = (db: Db, e: ExecRow, detail = false) => {
  const wf = db.get<{ name: string }>('SELECT name FROM workflows WHERE id = ?', e.workflow_id);
  const pr = db.get<{ name: string }>('SELECT name FROM projects WHERE id = ?', e.project_id);
  const ver = db.get<{ version: number }>('SELECT version FROM workflow_versions WHERE id = ?', e.workflow_version_id);
  const base = {
    id: e.id, projectId: e.project_id, projectName: pr?.name ?? '', workflowId: e.workflow_id, workflowName: wf?.name ?? '',
    workflowVersion: ver?.version ?? null, testCaseId: e.test_case_id, testName: e.test_name, engine: e.engine,
    realExecution: e.real_execution === 1, status: e.status, startedAt: e.started_at, durationMs: e.duration_ms,
    assertionsPassed: e.assertions_passed, assertionsFailed: e.assertions_failed, error: e.error,
    regression: e.regression === 1, baselineExecutionId: e.baseline_execution_id,
  };
  if (!detail) return base;
  const result = parse<{ assertions: unknown; trace: unknown; errorNode?: string }>(e.result);
  return { ...base, assertions: result.assertions, trace: result.trace, errorNode: result.errorNode ?? null, output: e.output ? parse<Json>(e.output) : null, diff: parse<DiffEntry[]>(e.diff) };
};

export async function runTests(db: Db, userId: string, workflowId: string, tests: TestRow[], engineKind: EngineKind, env: Record<string, string | undefined>) {
  const w = ownedWorkflow(db, userId, workflowId);
  const info = getEngine(engineKind).info(env);
  if (!info.available) throw new HttpError(409, 'engine_unavailable', `A engine "${info.label}" não está disponível: ${info.reason ?? 'indisponível'}`);
  const version = latestVersion(db, workflowId);
  const workflow = parse<JsonObject>(version.content);
  const out = [];
  for (const t of tests) {
    const outcome = await runTestCase({
      engine: engineKind, workflow, fixture: parse<Fixture>(t.fixture), assertions: parse<Assertion[]>(t.assertions), targetNode: t.target_node,
    });
    const baseline = db.get<ExecRow>(
      'SELECT * FROM executions WHERE test_case_id = ? AND engine = ? AND output IS NOT NULL ORDER BY started_at DESC LIMIT 1', t.id, engineKind);
    const dataJson = outcome.data ? JSON.stringify(outcome.data) : null;
    const diff: DiffEntry[] = outcome.data && baseline?.output ? diffJson(parse<Json>(baseline.output), outcome.data as unknown as Json) : [];
    const id = randomUUID();
    db.run(
      `INSERT INTO executions (id, user_id, project_id, workflow_id, workflow_version_id, test_case_id, test_name, engine, real_execution, status, started_at,
        duration_ms, assertions_passed, assertions_failed, error, result, output, diff, baseline_execution_id, regression)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, userId, w.project_id, workflowId, version.id, t.id, t.name, engineKind, info.realExecution ? 1 : 0, outcome.status, now(),
      outcome.durationMs, outcome.passed, outcome.failed, outcome.error ?? null,
      JSON.stringify({ assertions: outcome.assertionResults, trace: outcome.trace, ...(outcome.errorNode ? { errorNode: outcome.errorNode } : {}) }),
      dataJson !== null && dataJson.length <= MAX_OUTPUT_CHARS ? dataJson : dataJson === null ? null : JSON.stringify({ input: [], output: [], nodes: {}, truncated: true }),
      JSON.stringify(diff.slice(0, 200)), baseline?.id ?? null, baseline && baseline.status === 'passed' && outcome.status !== 'passed' ? 1 : 0,
    );
    out.push(mapExec(db, db.get<ExecRow>('SELECT * FROM executions WHERE id = ?', id) as ExecRow));
  }
  db.run('UPDATE workflows SET updated_at = ? WHERE id = ?', now(), workflowId);
  if (tests.length > 0) audit(db, userId, 'ran', 'workflow', workflowId, `${w.name} · ${engineKind} · ${tests.length} teste(s)`);
  return out;
}

export function runOneTest(db: Db, userId: string, testId: string, engine: EngineKind, env: Record<string, string | undefined>) {
  const t = ownedTest(db, userId, testId);
  if (t.status === 'disabled') throw new HttpError(409, 'test_disabled', 'Este teste está desativado.');
  return runTests(db, userId, t.workflow_id, [t], engine, env);
}

export function runAllTests(db: Db, userId: string, workflowId: string, engine: EngineKind, env: Record<string, string | undefined>) {
  ownedWorkflow(db, userId, workflowId);
  const tests = db.all<TestRow>("SELECT * FROM test_cases WHERE workflow_id = ? AND status = 'active' ORDER BY created_at", workflowId);
  if (tests.length === 0) throw new HttpError(409, 'no_tests', 'Não há testes ativos neste workflow.');
  return runTests(db, userId, workflowId, tests, engine, env);
}

export function listExecutions(db: Db, userId: string, q: URLSearchParams) {
  const where = ['e.user_id = ?'];
  const args: (string | number)[] = [userId];
  for (const [param, col] of [['projectId', 'project_id'], ['workflowId', 'workflow_id'], ['testId', 'test_case_id'], ['status', 'status'], ['engine', 'engine']] as const) {
    const v = q.get(param);
    if (v) { where.push(`e.${col} = ?`); args.push(v); }
  }
  if (q.get('regression') === '1') where.push('e.regression = 1');
  const limit = Math.min(Math.max(Number(q.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM executions e WHERE ${where.join(' AND ')}`, ...args)?.n ?? 0;
  const rows = db.all<ExecRow>(`SELECT e.* FROM executions e WHERE ${where.join(' AND ')} ORDER BY e.started_at DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  return { total, items: rows.map((e) => mapExec(db, e)) };
}

export function getExecution(db: Db, userId: string, id: string) {
  const e = db.get<ExecRow>('SELECT * FROM executions WHERE id = ? AND user_id = ?', id, userId);
  if (!e) throw notFound('Execução');
  return mapExec(db, e, true);
}

/* ---------- Dashboard, relatórios e configurações ---------- */

export function dashboard(db: Db, userId: string) {
  const count = (sql: string): number => db.get<{ n: number }>(sql, userId)?.n ?? 0;
  const projects = count('SELECT COUNT(*) n FROM projects WHERE user_id = ?');
  const workflows = count('SELECT COUNT(*) n FROM workflows w JOIN projects p ON p.id = w.project_id WHERE p.user_id = ?');
  const tests = count('SELECT COUNT(*) n FROM test_cases t JOIN workflows w ON w.id = t.workflow_id JOIN projects p ON p.id = w.project_id WHERE p.user_id = ?');
  const byStatus = Object.fromEntries(db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM executions WHERE user_id = ? GROUP BY status', userId).map((r) => [r.status, r.n]));
  const executions = (byStatus.passed ?? 0) + (byStatus.failed ?? 0) + (byStatus.error ?? 0);
  const byEngine = Object.fromEntries(db.all<{ engine: string; n: number }>('SELECT engine, COUNT(*) n FROM executions WHERE user_id = ? GROUP BY engine', userId).map((r) => [r.engine, r.n]));
  const days = db.all<{ day: string; passed: number; failed: number }>(
    `SELECT substr(started_at, 1, 10) day, SUM(status = 'passed') passed, SUM(status != 'passed') failed FROM executions
     WHERE user_id = ? AND started_at >= ? GROUP BY day ORDER BY day`, userId, new Date(Date.now() - 14 * 86400000).toISOString());
  const recent = db.all<ExecRow>('SELECT * FROM executions WHERE user_id = ? ORDER BY started_at DESC LIMIT 8', userId).map((e) => mapExec(db, e));
  const activity = db.all<{ action: string; entity: string; entity_id: string | null; label: string | null; created_at: string }>(
    'SELECT action, entity, entity_id, label, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 10', userId);
  return {
    totals: { projects, workflows, tests, executions, passed: byStatus.passed ?? 0, failed: byStatus.failed ?? 0, errors: byStatus.error ?? 0 },
    passRate: executions > 0 ? Math.round(((byStatus.passed ?? 0) / executions) * 100) : null,
    byEngine, daily: days.length >= 2 ? days : [], recent,
    activity: activity.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, label: a.label, createdAt: a.created_at })),
    projectOverview: listProjects(db, userId).slice(0, 6).map((p) => ({ id: p.id, name: p.name, client: p.client, quality: p.stats.quality, tests: p.stats.tests, workflows: p.stats.workflows })),
  };
}

function latestPerTest(db: Db, userId: string, projectId: string): ExecRow[] {
  return db.all<ExecRow>(
    `SELECT e.* FROM executions e WHERE e.user_id = ? AND e.project_id = ? AND e.test_case_id IS NOT NULL AND e.started_at = (
       SELECT MAX(x.started_at) FROM executions x WHERE x.test_case_id = e.test_case_id AND x.engine = e.engine)
     ORDER BY e.started_at DESC`, userId, projectId);
}

export function projectReport(db: Db, userId: string, projectId: string) {
  const p = ownedProject(db, userId, projectId);
  const latest = latestPerTest(db, userId, projectId).map((e) => mapExec(db, e));
  const count = (s: string) => latest.filter((e) => e.status === s).length;
  const real = latest.filter((e) => e.realExecution);
  return {
    generatedAt: now(),
    notice: 'Resultados da engine "simulated" não representam execuções reais no n8n.',
    project: { id: p.id, name: p.name, client: p.client },
    summary: { total: latest.length, passed: count('passed'), failed: count('failed'), errors: count('error'), regressions: latest.filter((e) => e.regression).length, realExecutions: real.length, simulatedExecutions: latest.length - real.length },
    results: latest,
    history: listExecutions(db, userId, new URLSearchParams({ projectId, limit: '100' })).items,
  };
}

export function projectJUnit(db: Db, userId: string, projectId: string): string {
  const report = projectReport(db, userId, projectId);
  const cases: ReportCase[] = report.results.map((e) => ({
    project: report.project.name, workflow: e.workflowName, test: e.testName, engine: e.engine, realExecution: e.realExecution,
    status: e.status, durationMs: e.durationMs, message: e.error ?? (e.status === 'failed' ? `${e.assertionsFailed} assertion(s) reprovada(s)` : null), startedAt: e.startedAt,
  }));
  return toJUnit(cases, report.generatedAt);
}

export function settings(db: Db, userId: string, env: Record<string, string | undefined>, cfg: { allowRegistration: boolean; production: boolean; maxBodyBytes: number }) {
  const u = db.get<{ email: string; name: string; created_at: string }>('SELECT email, name, created_at FROM users WHERE id = ?', userId);
  const sessions = db.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', userId)?.n ?? 0;
  return {
    user: { email: u?.email ?? '', name: u?.name ?? '', createdAt: u?.created_at ?? '', activeSessions: sessions },
    environment: { node: process.version, mode: cfg.production ? 'production' : 'development', database: 'SQLite (node:sqlite)', registrationOpen: cfg.allowRegistration, maxUploadBytes: cfg.maxBodyBytes },
    engines: listEngines(env),
    integrations: [
      { id: 'n8n-api', label: 'API do n8n', status: 'not_implemented', detail: 'A importação é feita por arquivo JSON exportado. Não há conexão com instâncias do n8n.' },
    ],
  };
}
