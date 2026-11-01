export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let csrf = '';
let onUnauthorized: () => void = () => undefined;
export const setCsrf = (t: string | null): void => { csrf = t ?? ''; };
export const setUnauthorizedHandler = (fn: () => void): void => { onUnauthorized = fn; };

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ApiError(0, 'network', 'Não foi possível conectar ao servidor.');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Algo deu errado. Tente novamente.', err?.fields ?? {});
  }
  return data as T;
}

export const get = <T>(p: string): Promise<T> => api<T>('GET', p);
export const post = <T>(p: string, b: unknown = {}): Promise<T> => api<T>('POST', p, b);
export const patch = <T>(p: string, b: unknown): Promise<T> => api<T>('PATCH', p, b);
export const del = <T>(p: string, b: unknown = {}): Promise<T> => api<T>('DELETE', p, b);
