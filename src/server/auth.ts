import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { Fields } from './validate.ts';
import { hashPassword, newToken, sha256, verifyPassword, DUMMY_HASH } from './security.ts';
import type { Json, JsonObject } from '../core/types.ts';

export const SESSION_COOKIE = 'fp_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  csrf: string;
  tokenHash: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookieHeader(token: string, secure: boolean, maxAgeMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

function checkPassword(f: Fields, body: JsonObject, key: string, email?: string): string | undefined {
  const pw = body[key];
  if (typeof pw !== 'string' || pw.length < 10) f.errors[key] = 'A senha deve ter ao menos 10 caracteres.';
  else if (pw.length > 200) f.errors[key] = 'A senha deve ter no máximo 200 caracteres.';
  else if (email && pw.toLowerCase() === email) f.errors[key] = 'A senha não pode ser igual ao e-mail.';
  else return pw;
  return undefined;
}

export async function registerUser(db: Db, body: JsonObject): Promise<{ id: string; email: string; name: string }> {
  const f = new Fields();
  const email = f.str(body, 'email', { max: 254, required: true, label: 'E-mail' })?.toLowerCase();
  if (email && !EMAIL_RE.test(email)) f.errors.email = 'E-mail inválido.';
  const name = f.str(body, 'name', { max: 100, required: true, label: 'Nome' });
  const password = checkPassword(f, body, 'password', email);
  f.done();
  const hash = await hashPassword(password as string);
  const id = randomUUID();
  try {
    db.run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, email as string, name as string, hash, new Date().toISOString());
  } catch {
    throw new HttpError(409, 'email_taken', 'Não foi possível criar a conta com este e-mail.');
  }
  return { id, email: email as string, name: name as string };
}

export async function authenticate(db: Db, body: JsonObject): Promise<{ id: string; email: string; name: string }> {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const row = db.get<{ id: string; email: string; name: string; password_hash: string }>('SELECT * FROM users WHERE email = ?', email);
  const ok = await verifyPassword(password.slice(0, 200), row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
  return { id: row.id, email: row.email, name: row.name };
}

export function createSession(db: Db, userId: string): { token: string; csrf: string } {
  const token = newToken();
  const csrf = newToken(24);
  const now = Date.now();
  db.run('DELETE FROM sessions WHERE expires_at < ?', new Date(now).toISOString());
  db.run('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, csrf, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return { token, csrf };
}

export function loadSession(db: Db, token: string | undefined): SessionUser | null {
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(token);
  const row = db.get<{ id: string; email: string; name: string; csrf_token: string; expires_at: string }>(
    'SELECT u.id, u.email, u.name, s.csrf_token, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, csrf: row.csrf_token, tokenHash };
}

export function destroySession(db: Db, tokenHash: string): void {
  db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

export async function changePassword(db: Db, user: SessionUser, body: JsonObject): Promise<void> {
  const f = new Fields();
  const next = checkPassword(f, body, 'newPassword', user.email);
  f.done();
  const row = db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!row || !(await verifyPassword(current.slice(0, 200), row.password_hash))) {
    throw new HttpError(422, 'validation', 'Verifique os campos informados.', { currentPassword: 'Senha atual incorreta.' });
  }
  const hash = await hashPassword(next as string);
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, user.tokenHash);
  });
}

export function updateName(db: Db, user: SessionUser, body: JsonObject): string {
  const f = new Fields();
  const name = f.str(body, 'name', { max: 100, required: true, label: 'Nome' });
  f.done();
  db.run('UPDATE users SET name = ? WHERE id = ?', name as string, user.id);
  return name as string;
}

export type { Json };
