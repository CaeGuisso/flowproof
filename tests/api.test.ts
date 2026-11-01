import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, cleanup, start } from './helpers.ts';
import type { Started } from './helpers.ts';

const sample = JSON.parse(readFileSync(new URL('./fixtures/sample-workflow.json', import.meta.url), 'utf8')) as Record<string, unknown>;
let s: Started;
let a: Client;

before(async () => {
  s = await start();
  a = new Client(s.base);
  await a.signup('ana@exemplo.com', 'Ana');
});
after(async () => { await s.stop(); cleanup(s.dir); });

async function newProject(c: Client, name = 'Cliente A') {
  const r = await c.post('/api/projects', { name, client: 'ACME', description: 'desc' });
  assert.equal(r.status, 201);
  return r.data as { id: string; name: string };
}
async function newWorkflow(c: Client, projectId: string, wf: unknown = sample) {
  const r = await c.post(`/api/projects/${projectId}/workflows`, { workflow: wf });
  assert.equal(r.status, 201, r.text);
  return r.data as { id: string; summary: { nodeCount: number } };
}
const goodTest = {
  name: 'Define status', description: 'd', targetNode: 'Preparar',
  fixture: { input: { nome: 'Ana' }, mocks: { 'Enviar Slack': [{ ok: true }], HTTP: [{ ok: true }] } },
  assertions: [{ path: 'output[0].status', op: 'equals', expected: 'ativo' }, { path: 'output[0].creditos', op: 'type', expected: 'number' }],
};

describe('autenticação e segurança', () => {
  test('rotas protegidas exigem login', async () => {
    const anon = new Client(s.base);
    assert.equal((await anon.get('/api/projects')).status, 401);
    assert.equal((await anon.get('/api/dashboard')).status, 401);
  });

  test('cookie de sessão é HttpOnly + SameSite=Strict e hash de senha não vaza', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { email: 'cookie@exemplo.com', name: 'C', password: 'senha-segura-123' });
    const set = r.headers.get('set-cookie') ?? '';
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    assert.ok(!r.text.includes('scrypt'));
  });

  test('registro valida campos e rejeita e-mail duplicado', async () => {
    const c = new Client(s.base);
    const bad = await c.post('/api/auth/register', { email: 'x', name: '', password: 'curta' });
    assert.equal(bad.status, 422);
    assert.ok(bad.data.error.fields.email && bad.data.error.fields.name && bad.data.error.fields.password);
    const dup = await c.post('/api/auth/register', { email: 'ANA@exemplo.com', name: 'Ana 2', password: 'senha-segura-123' });
    assert.equal(dup.status, 409);
  });

  test('login correto/incorreto e logout invalida a sessão', async () => {
    const c = new Client(s.base);
    assert.equal((await c.post('/api/auth/login', { email: 'ana@exemplo.com', password: 'errada-errada' })).status, 401);
    assert.equal((await c.post('/api/auth/login', { email: 'ana@exemplo.com', password: 'senha-segura-123' })).status, 200);
    assert.equal((await c.get('/api/projects')).status, 200);
    const old = c.cookie;
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    const stale = new Client(s.base);
    stale.cookie = old;
    assert.equal((await stale.get('/api/projects')).status, 401);
  });

  test('CSRF: sem token ou com origem externa é rejeitado', async () => {
    const noToken = await a.call('POST', '/api/projects', { name: 'X' }, { 'X-CSRF-Token': 'errado' });
    assert.equal(noToken.status, 403);
    const evil = await a.call('POST', '/api/projects', { name: 'X' }, { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.data.error.code, 'forbidden_origin');
  });

  test('exige application/json e limita tamanho do corpo', async () => {
    const wrong = await a.call('POST', '/api/projects', 'name=x', { 'Content-Type': 'text/plain' });
    assert.ok([415, 400].includes(wrong.status));
    const p = await newProject(a, 'Limite');
    const huge = await a.post(`/api/projects/${p.id}/workflows`, { workflow: { nodes: [], pad: 'x'.repeat(3 * 1024 * 1024) } });
    assert.equal(huge.status, 413);
    assert.equal((await a.call('POST', '/api/projects', '{ não é json')).status, 400);
  });

  test('cabeçalhos de segurança presentes', async () => {
    const r = await fetch(`${s.base}/`);
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  });

  test('estáticos: path traversal bloqueado e SPA fallback', async () => {
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/assets/%00.js']) {
      const r = await fetch(`${s.base}${p}`);
      assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!(await r.text()).includes('flowproof"'));
    }
    const spa = await fetch(`${s.base}/projects/abc`);
    assert.equal(spa.status, 200);
    assert.match(spa.headers.get('content-type') ?? '', /text\/html/);
    assert.equal((await fetch(`${s.base}/segredo.env`)).status, 404);
  });

  test('limite de tentativas de login (429)', async () => {
    const c = new Client(s.base);
    let last = 0;
    for (let i = 0; i < 10; i += 1) last = (await c.post('/api/auth/login', { email: 'alvo@exemplo.com', password: 'qualquer-coisa' })).status;
    assert.equal(last, 429);
  });

  test('erros internos não expõem detalhes', async () => {
    const r = await a.get('/api/projects/nao-existe');
    assert.equal(r.status, 404);
    assert.ok(!/stack|node_modules|sqlite/i.test(r.text));
  });
});

describe('projetos, isolamento e exclusão segura', () => {
  test('CRUD completo com confirmação por nome', async () => {
    const p = await newProject(a, 'CRUD');
    const upd = await a.patch(`/api/projects/${p.id}`, { name: 'CRUD 2', client: 'Z', description: '' });
    assert.equal(upd.data.name, 'CRUD 2');
    assert.equal((await a.patch(`/api/projects/${p.id}`, { name: '' })).status, 422);
    assert.equal((await a.del(`/api/projects/${p.id}`, { confirmName: 'errado' })).status, 422);
    assert.equal((await a.del(`/api/projects/${p.id}`, { confirmName: 'CRUD 2' })).status, 200);
    assert.equal((await a.get(`/api/projects/${p.id}`)).status, 404);
  });

  test('um usuário não acessa dados de outro', async () => {
    const b = new Client(s.base);
    await b.signup('bruno@exemplo.com', 'Bruno');
    const p = await newProject(a, 'Privado');
    const wf = await newWorkflow(a, p.id);
    const t = await a.post(`/api/workflows/${wf.id}/tests`, goodTest);
    assert.equal(t.status, 201);
    const run = await a.post(`/api/tests/${t.data.id}/run`, { engine: 'simulated' });
    assert.equal(run.status, 200, run.text);
    const probes: [string, string, unknown?][] = [
      ['GET', `/api/projects/${p.id}`], ['PATCH', `/api/projects/${p.id}`, { name: 'x' }], ['DELETE', `/api/projects/${p.id}`, { confirmName: 'Privado' }],
      ['GET', `/api/projects/${p.id}/workflows`], ['POST', `/api/projects/${p.id}/workflows`, { workflow: sample }],
      ['GET', `/api/workflows/${wf.id}`], ['GET', `/api/workflows/${wf.id}/export`], ['GET', `/api/workflows/${wf.id}/diff`],
      ['POST', `/api/workflows/${wf.id}/versions`, { workflow: sample }], ['GET', `/api/workflows/${wf.id}/tests`],
      ['POST', `/api/workflows/${wf.id}/run`, { engine: 'simulated' }], ['GET', `/api/tests/${t.data.id}`],
      ['PATCH', `/api/tests/${t.data.id}`, goodTest], ['DELETE', `/api/tests/${t.data.id}`], ['POST', `/api/tests/${t.data.id}/run`, { engine: 'simulated' }],
      ['GET', `/api/executions/${run.data.id}`], ['GET', `/api/projects/${p.id}/report`], ['GET', `/api/projects/${p.id}/report.junit.xml`],
    ];
    for (const [m, path, body] of probes) {
      const r = await b.call(m, path, body);
      assert.equal(r.status, 404, `${m} ${path} deveria ser 404, foi ${r.status}`);
    }
    assert.equal((await b.get('/api/projects')).data.length, 0);
    assert.equal((await b.get('/api/executions')).data.total, 0);
    assert.equal((await b.get('/api/dashboard')).data.totals.projects, 0);
    assert.equal((await a.get(`/api/projects/${p.id}`)).status, 200);
  });
});

describe('workflows', () => {
  test('importa, sanitiza e nunca devolve segredos (inclusive no export)', async () => {
    const p = await newProject(a, 'Import');
    const wf = await newWorkflow(a, p.id);
    assert.equal(wf.summary.nodeCount, 4);
    const ex = await a.get(`/api/workflows/${wf.id}/export`);
    assert.match(ex.headers.get('content-disposition') ?? '', /attachment/);
    const full = (await a.get(`/api/workflows/${wf.id}`)).text + ex.text + (await a.get(`/api/workflows/${wf.id}/versions/1`)).text;
    for (const leak of ['super-secreta-123', 'abcdefghijklmnop123456', 'maria@cliente.com', '123.456.789-00', 'Slack da agencia']) assert.ok(!full.includes(leak), leak);
    assert.ok((await a.get(`/api/workflows/${wf.id}`)).data.current.redactionCount > 0);
  });

  test('rejeita JSON inválido com mensagem clara', async () => {
    const p = await newProject(a, 'Invalido');
    for (const bad of [{ workflow: 'texto' }, { workflow: { nodes: [] , connections: {} } }, { workflow: { nodes: [{ name: 'A', type: 'x.y' }], connections: { B: {} } } }, {}]) {
      const r = await a.post(`/api/projects/${p.id}/workflows`, bad);
      assert.equal(r.status, 422, JSON.stringify(bad));
    }
    assert.equal((await a.get(`/api/projects/${p.id}/workflows`)).data.length, 0);
  });

  test('versões: nova versão, idempotência e comparação', async () => {
    const p = await newProject(a, 'Versoes');
    const wf = await newWorkflow(a, p.id);
    const same = await a.post(`/api/workflows/${wf.id}/versions`, { workflow: sample });
    assert.equal(same.data.unchanged, true);
    const v2 = structuredClone(sample) as { nodes: { name: string; parameters: Record<string, unknown> }[] };
    v2.nodes[2]!.parameters.channel = '#suporte';
    v2.nodes.push({ name: 'Novo', type: 'n8n-nodes-base.noOp', parameters: {} } as never);
    const r = await a.post(`/api/workflows/${wf.id}/versions`, { workflow: v2 });
    assert.equal(r.data.unchanged, false);
    assert.equal(r.data.workflow.current.version, 2);
    const d = (await a.get(`/api/workflows/${wf.id}/diff?from=1&to=2`)).data.diff;
    assert.deepEqual(d.nodesAdded, ['Novo']);
    assert.equal(d.nodesChanged[0].name, 'Enviar Slack');
    assert.equal((await a.get(`/api/workflows/${wf.id}/versions/99`)).status, 404);
  });

  test('exclusão exige o nome e remove testes/histórico em cascata', async () => {
    const p = await newProject(a, 'Cascata');
    const wf = await newWorkflow(a, p.id);
    const t = await a.post(`/api/workflows/${wf.id}/tests`, goodTest);
    await a.post(`/api/tests/${t.data.id}/run`, { engine: 'simulated' });
    const name = (await a.get(`/api/workflows/${wf.id}`)).data.name;
    assert.equal((await a.del(`/api/workflows/${wf.id}`, { confirmName: 'x' })).status, 422);
    assert.equal((await a.del(`/api/workflows/${wf.id}`, { confirmName: name })).status, 200);
    assert.equal((await a.get(`/api/tests/${t.data.id}`)).status, 404);
    assert.equal((await a.get(`/api/executions?workflowId=${wf.id}`)).data.total, 0);
  });

  test('workflow de exemplo é criado com testes e pode ser removido', async () => {
    const p = await newProject(a, 'Exemplo');
    const wf = (await a.post(`/api/projects/${p.id}/example`)).data;
    assert.equal(wf.isExample, true);
    const run = await a.post(`/api/workflows/${wf.id}/run`, { engine: 'simulated' });
    assert.equal(run.status, 200, run.text);
    assert.ok(run.data.every((e: { status: string }) => e.status === 'passed'), run.text);
    assert.equal((await a.del(`/api/workflows/${wf.id}`, { confirmName: wf.name })).status, 200);
  });
});

describe('casos de teste e execuções', () => {
  test('validação de assertions e fixture', async () => {
    const p = await newProject(a, 'Testes');
    const wf = await newWorkflow(a, p.id);
    const base = `/api/workflows/${wf.id}/tests`;
    assert.equal((await a.post(base, { ...goodTest, name: '' })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, assertions: [] })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, assertions: [{ path: 'a', op: 'contains' }] })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, assertions: [{ path: 'a', op: 'type', expected: 'x' }] })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, assertions: [{ path: 'a..b', op: 'exists' }] })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, fixture: { mocks: { X: 'nao-lista' } } })).status, 422);
    assert.equal((await a.post(base, { ...goodTest, targetNode: 'Fantasma' })).status, 422);
  });

  test('criar, editar, duplicar, desativar e excluir', async () => {
    const p = await newProject(a, 'Ciclo');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    const edited = await a.patch(`/api/tests/${t.id}`, { ...goodTest, name: 'Renomeado', status: 'disabled' });
    assert.equal(edited.data.name, 'Renomeado');
    assert.equal((await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' })).status, 409);
    const dup = await a.post(`/api/tests/${t.id}/duplicate`);
    assert.match(dup.data.name, /cópia/);
    assert.equal((await a.get(`/api/workflows/${wf.id}/tests`)).data.length, 2);
    assert.equal((await a.del(`/api/tests/${t.id}`)).status, 200);
    assert.equal((await a.get(`/api/workflows/${wf.id}/tests`)).data.length, 1);
  });

  test('execução simulada grava histórico, marca engine e nunca "real"', async () => {
    const p = await newProject(a, 'Exec');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    const run = await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' });
    assert.equal(run.data.status, 'passed');
    assert.equal(run.data.engine, 'simulated');
    assert.equal(run.data.realExecution, false);
    const detail = (await a.get(`/api/executions/${run.data.id}`)).data;
    assert.equal(detail.assertions.length, 2);
    assert.ok(detail.trace.length >= 3);
    assert.ok(typeof detail.durationMs === 'number');
    const list = (await a.get(`/api/executions?workflowId=${wf.id}&engine=simulated`)).data;
    assert.equal(list.total, 1);
    assert.equal((await a.get(`/api/executions?engine=real_local`)).data.items.filter((e: { realExecution: boolean }) => e.realExecution).length, 0);
  });

  test('engines reais retornam 409 e não registram execução', async () => {
    const p = await newProject(a, 'Real');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    for (const engine of ['real_local', 'real_container']) {
      const r = await a.post(`/api/tests/${t.id}/run`, { engine });
      assert.equal(r.status, 409);
      assert.equal(r.data.error.code, 'engine_unavailable');
    }
    assert.equal((await a.post(`/api/tests/${t.id}/run`, { engine: 'inexistente' })).status, 422);
    assert.equal((await a.get(`/api/executions?workflowId=${wf.id}`)).data.total, 0);
  });

  test('erro de execução (nó sem mock) é registrado como "error"', async () => {
    const p = await newProject(a, 'Erro');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, { ...goodTest, fixture: { input: {} }, targetNode: '' })).data;
    const run = (await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' })).data;
    assert.equal(run.status, 'error');
    assert.match(run.error, /Enviar Slack/);
  });

  test('regressão: passou → falhou após nova versão, com diff do resultado', async () => {
    const p = await newProject(a, 'Regressao');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    const first = (await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' })).data;
    assert.equal(first.status, 'passed');
    assert.equal(first.regression, false);
    const v2 = structuredClone(sample) as { nodes: { parameters: { assignments: { assignments: { value: string }[] } } }[] };
    v2.nodes[1]!.parameters.assignments.assignments[0]!.value = 'inativo';
    await a.post(`/api/workflows/${wf.id}/versions`, { workflow: v2 });
    const second = (await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' })).data;
    assert.equal(second.status, 'failed');
    assert.equal(second.regression, true);
    assert.equal(second.baselineExecutionId, first.id);
    assert.equal(second.workflowVersion, 2);
    const detail = (await a.get(`/api/executions/${second.id}`)).data;
    const change = detail.diff.find((d: { path: string }) => d.path === 'output[0].status');
    assert.deepEqual([change.kind, change.before, change.after], ['changed', 'ativo', 'inativo']);
    assert.equal((await a.get(`/api/executions?regression=1&workflowId=${wf.id}`)).data.total, 1);
  });
});

describe('dashboard e relatórios', () => {
  test('dashboard reflete dados reais', async () => {
    const c = new Client(s.base);
    await c.signup('dash@exemplo.com', 'Dash');
    const empty = (await c.get('/api/dashboard')).data;
    assert.equal(empty.totals.projects, 0);
    assert.equal(empty.passRate, null);
    assert.deepEqual(empty.daily, []);
    const p = await newProject(c, 'D');
    const wf = await newWorkflow(c, p.id);
    const t = (await c.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    await c.post(`/api/tests/${t.id}/run`, { engine: 'simulated' });
    await c.patch(`/api/tests/${t.id}`, { ...goodTest, assertions: [{ path: 'output[0].status', op: 'equals', expected: 'x' }] });
    await c.post(`/api/tests/${t.id}/run`, { engine: 'simulated' });
    const d = (await c.get('/api/dashboard')).data;
    assert.deepEqual([d.totals.projects, d.totals.workflows, d.totals.tests, d.totals.executions, d.totals.passed, d.totals.failed], [1, 1, 1, 2, 1, 1]);
    assert.equal(d.passRate, 50);
    assert.equal(d.byEngine.simulated, 2);
    assert.ok(d.activity.length > 0);
  });

  test('relatório JSON e JUnit distinguem simulado de real', async () => {
    const p = await newProject(a, 'Relatorio');
    const wf = await newWorkflow(a, p.id);
    const t = (await a.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    await a.post(`/api/tests/${t.id}/run`, { engine: 'simulated' });
    const rep = (await a.get(`/api/projects/${p.id}/report`)).data;
    assert.equal(rep.summary.total, 1);
    assert.equal(rep.summary.simulatedExecutions, 1);
    assert.equal(rep.summary.realExecutions, 0);
    assert.match(rep.notice, /simulated/);
    const json = await a.get(`/api/projects/${p.id}/report.json`);
    assert.match(json.headers.get('content-disposition') ?? '', /attachment/);
    const xml = await a.get(`/api/projects/${p.id}/report.junit.xml`);
    assert.match(xml.text, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.match(xml.text, /real_execution" value="false"/);
    assert.match(xml.text, /tests="1" failures="0" errors="0"/);
  });

  test('configurações listam engines reais como indisponíveis', async () => {
    const st = (await a.get('/api/settings')).data;
    const real = st.engines.filter((e: { realExecution: boolean }) => e.realExecution);
    assert.equal(real.length, 2);
    assert.ok(real.every((e: { available: boolean }) => e.available === false));
    assert.equal(st.integrations[0].status, 'not_implemented');
    assert.ok(!JSON.stringify(st).includes('password'));
  });

  test('troca de senha derruba outras sessões e exige a senha atual', async () => {
    const c1 = new Client(s.base);
    await c1.signup('senha@exemplo.com', 'S');
    const c2 = new Client(s.base);
    await c2.post('/api/auth/login', { email: 'senha@exemplo.com', password: 'senha-segura-123' });
    assert.equal((await c1.post('/api/auth/password', { currentPassword: 'errada', newPassword: 'nova-senha-456' })).status, 422);
    assert.equal((await c1.post('/api/auth/password', { currentPassword: 'senha-segura-123', newPassword: 'nova-senha-456' })).status, 200);
    assert.equal((await c2.get('/api/projects')).status, 401);
    assert.equal((await c1.get('/api/projects')).status, 200);
  });
});

describe('persistência', () => {
  test('dados sobrevivem à reinicialização do servidor', async () => {
    const dir = s.dir + '-persist';
    const one = await start(dir);
    const c = new Client(one.base);
    await c.signup('persist@exemplo.com');
    const p = await newProject(c, 'Persistente');
    const wf = await newWorkflow(c, p.id);
    const t = (await c.post(`/api/workflows/${wf.id}/tests`, goodTest)).data;
    await c.post(`/api/tests/${t.id}/run`, { engine: 'simulated' });
    await one.stop();
    const two = await start(dir);
    const c2 = new Client(two.base);
    const login = await c2.post('/api/auth/login', { email: 'persist@exemplo.com', password: 'senha-segura-123' });
    assert.equal(login.status, 200);
    assert.equal((await c2.get('/api/projects')).data[0].name, 'Persistente');
    assert.equal((await c2.get(`/api/workflows/${wf.id}/tests`)).data.length, 1);
    assert.equal((await c2.get('/api/executions')).data.total, 1);
    await two.stop();
    cleanup(dir);
  });
});
