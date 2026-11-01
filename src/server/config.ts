import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  production: boolean;
  dbPath: string;
  allowRegistration: boolean;
  cookieSecure: boolean;
  trustProxy: boolean;
  maxBodyBytes: number;
  publicDir: string;
  env: Record<string, string | undefined>;
}

const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());

export function loadConfig(env: Record<string, string | undefined> = process.env, overrides: Partial<Config> = {}): Config {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 3000);
  const maxBody = Number(env.FLOWPROOF_MAX_BODY_BYTES ?? 2 * 1024 * 1024);
  return {
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 3000,
    host: env.HOST ?? '127.0.0.1',
    production,
    dbPath: resolve(env.FLOWPROOF_DB_PATH ?? './data/flowproof.db'),
    allowRegistration: bool(env.FLOWPROOF_ALLOW_REGISTRATION, true),
    cookieSecure: bool(env.FLOWPROOF_COOKIE_SECURE, production),
    trustProxy: bool(env.FLOWPROOF_TRUST_PROXY, false),
    maxBodyBytes: Number.isFinite(maxBody) && maxBody > 1024 ? maxBody : 2 * 1024 * 1024,
    publicDir: resolve(env.FLOWPROOF_PUBLIC_DIR ?? './public'),
    env,
    ...overrides,
  };
}
