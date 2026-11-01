import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.ts';
import type { App } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { Config } from '../src/server/config.ts';

export interface Started { app: App; base: string; dir: string; cfg: Config; stop: () => Promise<void> }

export async function start(dir = mkdtempSync(join(tmpdir(), 'flowproof-')), overrides: Partial<Config> = {}): Promise<Started> {
  const cfg = loadConfig({}, { dbPath: join(dir, 'test.db'), port: 0, publicDir: join(process.cwd(), 'public'), ...overrides });
  const app = createApp(cfg);
  await new Promise<void>((ok) => app.server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, base, dir, cfg, stop: async () => { await app.close(); } };
}

export const cleanup = (dir: string): void => rmSync(dir, { recursive: true, force: true });

export class Client {
  cookie = '';
  csrf = '';
  readonly base: string;
  constructor(base: string) { this.base = base; }

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: any; headers: Headers; text: string }> {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET' && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = this.csrf;
    const res = await fetch(this.base + path, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    const text = await res.text();
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0] as string;
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* não é JSON */ }
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, data, headers: res.headers, text };
  }

  get = (p: string) => this.call('GET', p);
  post = (p: string, b: unknown = {}) => this.call('POST', p, b);
  patch = (p: string, b: unknown) => this.call('PATCH', p, b);
  del = (p: string, b: unknown = {}) => this.call('DELETE', p, b);

  async signup(email: string, name = 'Teste'): Promise<void> {
    const r = await this.post('/api/auth/register', { email, name, password: 'senha-segura-123' });
    if (r.status !== 200) throw new Error(`signup falhou: ${r.status} ${r.text}`);
  }
}
