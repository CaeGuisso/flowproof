import { HttpError, Reply, Router, json } from './http.ts';
import type { Ctx } from './http.ts';
import type { SessionUser } from './auth.ts';
import {
  authenticate, changePassword, cookieHeader, createSession, destroySession, registerUser, updateName,
} from './auth.ts';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { RateLimiter } from './security.ts';
import * as store from './store.ts';

const user = (ctx: Ctx): SessionUser => {
  if (!ctx.user) throw new HttpError(401, 'unauthorized', 'Faça login para continuar.');
  return ctx.user;
};

const download = (filename: string, type: string, body: string): Reply =>
  new Reply(200, body, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"` });

export function buildRouter(db: Db, cfg: Config): Router {
  const r = new Router();
  const loginByPair = new RateLimiter(8, 15 * 60_000);
  const loginByIp = new RateLimiter(40, 15 * 60_000);
  const registerByIp = new RateLimiter(10, 60 * 60_000);
  const runLimiter = new RateLimiter(120, 60_000);

  const startSession = (id: string, email: string, name: string): Reply => {
    const { token, csrf } = createSession(db, id);
    const reply = json({ user: { id, email, name }, csrf, registrationOpen: cfg.allowRegistration });
    return new Reply(reply.status, reply.body, { ...reply.headers, 'Set-Cookie': cookieHeader(token, cfg.cookieSecure) });
  };

  r.add('GET', '/api/auth/me', (ctx) => ({
    user: ctx.user ? { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name } : null,
    csrf: ctx.user?.csrf ?? null,
    registrationOpen: cfg.allowRegistration,
  }), { public: true });

  r.add('POST', '/api/auth/register', async (ctx) => {
    if (!cfg.allowRegistration) throw new HttpError(403, 'registration_closed', 'O cadastro está desativado neste ambiente.');
    if (!registerByIp.take(ctx.ip)) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
    const u = await registerUser(db, await ctx.body());
    store.audit(db, u.id, 'registered', 'user', u.id, null);
    return startSession(u.id, u.email, u.name);
  }, { public: true });

  r.add('POST', '/api/auth/login', async (ctx) => {
    const body = await ctx.body();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    const pair = `${ctx.ip}|${email}`;
    if (!loginByIp.take(ctx.ip) || !loginByPair.take(pair)) {
      throw new HttpError(429, 'rate_limited', 'Muitas tentativas de login. Aguarde alguns minutos.');
    }
    const u = await authenticate(db, body);
    loginByPair.reset(pair);
    return startSession(u.id, u.email, u.name);
  }, { public: true });

  r.add('POST', '/api/auth/logout', (ctx) => {
    destroySession(db, user(ctx).tokenHash);
    return new Reply(200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieHeader('', cfg.cookieSecure, 0) });
  });

  r.add('PATCH', '/api/auth/profile', async (ctx) => ({ name: updateName(db, user(ctx), await ctx.body()) }));
  r.add('POST', '/api/auth/password', async (ctx) => {
    await changePassword(db, user(ctx), await ctx.body());
    return { ok: true };
  });

  r.add('GET', '/api/dashboard', (ctx) => store.dashboard(db, user(ctx).id));
  r.add('GET', '/api/settings', (ctx) => store.settings(db, user(ctx).id, cfg.env, cfg));

  r.add('GET', '/api/projects', (ctx) => store.listProjects(db, user(ctx).id));
  r.add('POST', '/api/projects', async (ctx) => json(store.createProject(db, user(ctx).id, await ctx.body()), 201));
  r.add('GET', '/api/projects/:id', (ctx) => store.getProject(db, user(ctx).id, ctx.params.id as string));
  r.add('PATCH', '/api/projects/:id', async (ctx) => store.updateProject(db, user(ctx).id, ctx.params.id as string, await ctx.body()));
  r.add('DELETE', '/api/projects/:id', async (ctx) => {
    store.deleteProject(db, user(ctx).id, ctx.params.id as string, await ctx.body());
    return { ok: true };
  });
  r.add('GET', '/api/projects/:id/workflows', (ctx) => store.listWorkflows(db, user(ctx).id, ctx.params.id as string));
  r.add('POST', '/api/projects/:id/workflows', async (ctx) => json(store.importIntoProject(db, user(ctx).id, ctx.params.id as string, await ctx.body()), 201));
  r.add('POST', '/api/projects/:id/example', (ctx) => json(store.addExample(db, user(ctx).id, ctx.params.id as string), 201));
  r.add('GET', '/api/projects/:id/report', (ctx) => store.projectReport(db, user(ctx).id, ctx.params.id as string));
  r.add('GET', '/api/projects/:id/report.json', (ctx) =>
    download('flowproof-relatorio.json', 'application/json; charset=utf-8', JSON.stringify(store.projectReport(db, user(ctx).id, ctx.params.id as string), null, 2)));
  r.add('GET', '/api/projects/:id/report.junit.xml', (ctx) =>
    download('flowproof-junit.xml', 'application/xml; charset=utf-8', store.projectJUnit(db, user(ctx).id, ctx.params.id as string)));

  r.add('GET', '/api/workflows/:id', (ctx) => store.getWorkflow(db, user(ctx).id, ctx.params.id as string));
  r.add('DELETE', '/api/workflows/:id', async (ctx) => {
    store.deleteWorkflow(db, user(ctx).id, ctx.params.id as string, await ctx.body());
    return { ok: true };
  });
  r.add('POST', '/api/workflows/:id/versions', async (ctx) => json(store.addVersion(db, user(ctx).id, ctx.params.id as string, await ctx.body()), 201));
  r.add('GET', '/api/workflows/:id/versions/:version', (ctx) => store.workflowVersionContent(db, user(ctx).id, ctx.params.id as string, ctx.params.version as string));
  r.add('GET', '/api/workflows/:id/diff', (ctx) => store.compareVersions(db, user(ctx).id, ctx.params.id as string, ctx.query.get('from'), ctx.query.get('to')));
  r.add('GET', '/api/workflows/:id/export', (ctx) => {
    const out = store.exportWorkflow(db, user(ctx).id, ctx.params.id as string, ctx.query.get('version'));
    return download(out.filename, 'application/json; charset=utf-8', out.body);
  });
  r.add('GET', '/api/workflows/:id/tests', (ctx) => store.listTests(db, user(ctx).id, ctx.params.id as string));
  r.add('POST', '/api/workflows/:id/tests', async (ctx) => json(store.createTest(db, user(ctx).id, ctx.params.id as string, await ctx.body()), 201));
  r.add('POST', '/api/workflows/:id/run', async (ctx) => {
    const u = user(ctx);
    if (!runLimiter.take(u.id)) throw new HttpError(429, 'rate_limited', 'Muitas execuções em pouco tempo.');
    return json(await store.runAllTests(db, u.id, ctx.params.id as string, store.parseEngine((await ctx.body()).engine), cfg.env));
  });

  r.add('GET', '/api/tests/:id', (ctx) => store.getTest(db, user(ctx).id, ctx.params.id as string));
  r.add('PATCH', '/api/tests/:id', async (ctx) => store.updateTest(db, user(ctx).id, ctx.params.id as string, await ctx.body()));
  r.add('DELETE', '/api/tests/:id', (ctx) => {
    store.deleteTest(db, user(ctx).id, ctx.params.id as string);
    return { ok: true };
  });
  r.add('POST', '/api/tests/:id/duplicate', (ctx) => json(store.duplicateTest(db, user(ctx).id, ctx.params.id as string), 201));
  r.add('POST', '/api/tests/:id/run', async (ctx) => {
    const u = user(ctx);
    if (!runLimiter.take(u.id)) throw new HttpError(429, 'rate_limited', 'Muitas execuções em pouco tempo.');
    const out = await store.runOneTest(db, u.id, ctx.params.id as string, store.parseEngine((await ctx.body()).engine), cfg.env);
    return json(out[0]);
  });

  r.add('GET', '/api/executions', (ctx) => store.listExecutions(db, user(ctx).id, ctx.query));
  r.add('GET', '/api/executions/:id', (ctx) => store.getExecution(db, user(ctx).id, ctx.params.id as string));
  return r;
}
