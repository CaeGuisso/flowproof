import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Config } from './config.ts';
import { Db } from './db.ts';
import { HttpError, Reply, json, readJsonBody } from './http.ts';
import type { Ctx } from './http.ts';
import { SESSION_COOKIE, loadSession, parseCookies } from './auth.ts';
import { buildRouter } from './routes.ts';
import { RateLimiter, applySecurityHeaders, safeEqual } from './security.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

function send(res: ServerResponse, reply: Reply, head = false): void {
  res.writeHead(reply.status, { 'Content-Length': Buffer.byteLength(reply.body), ...reply.headers });
  res.end(head ? undefined : reply.body);
}

async function serveStatic(cfg: Config, path: string): Promise<Reply> {
  let rel: string;
  try { rel = decodeURIComponent(path); } catch { throw new HttpError(400, 'bad_request', 'Requisição inválida.'); }
  if (rel.includes('\0') || rel.includes('\\')) throw new HttpError(400, 'bad_request', 'Requisição inválida.');
  const root = resolve(cfg.publicDir);
  let file = resolve(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, 'not_found', 'Não encontrado.');
  const ext = extname(file);
  if (ext === '') file = join(root, 'index.html');
  else if (!MIME[ext]) throw new HttpError(404, 'not_found', 'Não encontrado.');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const isIndex = file.endsWith('index.html');
    return new Reply(200, body, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=300' });
  } catch {
    throw new HttpError(404, 'not_found', 'Não encontrado.');
  }
}

export interface App {
  server: Server;
  db: Db;
  close: () => Promise<void>;
}

export function createApp(cfg: Config): App {
  const db = new Db(cfg.dbPath);
  const router = buildRouter(db, cfg);
  const apiLimiter = new RateLimiter(900, 60_000);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const head = method === 'HEAD';
    applySecurityHeaders(res, cfg.cookieSecure);
    if (!path.startsWith('/api/') && path !== '/api') {
      if (method !== 'GET' && !head) throw new HttpError(405, 'method_not_allowed', 'Método não permitido.');
      return send(res, await serveStatic(cfg, path), head);
    }
    res.setHeader('Cache-Control', 'no-store');
    const ip = clientIp(req, cfg.trustProxy);
    if (!apiLimiter.take(ip)) throw new HttpError(429, 'rate_limited', 'Muitas requisições. Tente novamente em instantes.');
    const m = router.match(method, path);
    if (m === null) throw new HttpError(404, 'not_found', 'Rota não encontrada.');
    if (m === 'method') throw new HttpError(405, 'method_not_allowed', 'Método não permitido.');
    const session = loadSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!m.route.public && !session) throw new HttpError(401, 'unauthorized', 'Faça login para continuar.');
    if (STATE_CHANGING.has(method)) {
      if (!originAllowed(req)) throw new HttpError(403, 'forbidden_origin', 'Origem da requisição não permitida.');
      if (session && !m.route.public) {
        const token = req.headers['x-csrf-token'];
        if (typeof token !== 'string' || !safeEqual(token, session.csrf)) throw new HttpError(403, 'csrf', 'Token CSRF inválido. Recarregue a página.');
      }
    }
    const ctx: Ctx = {
      req, res, method, path, query: url.searchParams, params: m.params, ip, user: session,
      body: () => readJsonBody(req, cfg.maxBodyBytes),
    };
    const out = await m.route.handler(ctx);
    send(res, out instanceof Reply ? out : json(out), head);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) {
        const body = JSON.stringify({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
        res.setHeader('Cache-Control', 'no-store');
        send(res, new Reply(err.status, body, { 'Content-Type': 'application/json; charset=utf-8' }));
        return;
      }
      const id = randomUUID().slice(0, 8);
      console.error(`[erro ${id}]`, err instanceof Error ? err.stack : String(err));
      send(res, new Reply(500, JSON.stringify({ error: { code: 'internal', message: `Erro interno. Código ${id}.` } }), { 'Content-Type': 'application/json; charset=utf-8' }));
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return {
    server, db,
    close: () => new Promise<void>((done) => { server.close(() => { db.close(); done(); }); server.closeAllConnections(); }),
  };
}
