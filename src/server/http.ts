import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Json, JsonObject } from '../core/types.ts';
import type { SessionUser } from './auth.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (what = 'Recurso'): HttpError => new HttpError(404, 'not_found', `${what} não encontrado.`);

export class Reply {
  readonly status: number;
  readonly body: string | Buffer;
  readonly headers: Record<string, string>;
  constructor(status: number, body: string | Buffer, headers: Record<string, string> = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const json = (data: unknown, status = 200): Reply =>
  new Reply(status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  ip: string;
  user: SessionUser | null;
  body: () => Promise<JsonObject>;
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonObject> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Envie o corpo como application/json.');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'Corpo da requisição grande demais.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'Corpo da requisição grande demais.');
    chunks.push(chunk as Buffer);
  }
  let parsed: Json;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON inválido.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'O corpo deve ser um objeto JSON.');
  }
  return parsed;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  public: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { public?: boolean } = {}): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, public: opts.public ?? false });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const segs = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i += 1) {
        const p = r.parts[i] as string;
        const s = segs[i] as string;
        if (p.startsWith(':')) {
          try { params[p.slice(1)] = decodeURIComponent(s); } catch { ok = false; break; }
        } else if (p !== s) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}
