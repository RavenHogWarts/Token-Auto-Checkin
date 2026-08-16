/** Authorization 头工具。移植自 reference/auth-headers.js。 */

export type HeaderMap = Record<string, string>;

export function hasAuthorizationHeader(headers: HeaderMap | undefined): boolean {
  return Object.entries(headers || {}).some(
    ([name, value]) => name.toLowerCase() === 'authorization' && String(value || '').trim() !== '',
  );
}

export function buildAuthorizationValue(token: string | null | undefined): string | null {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;
  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

export function mergeAuthorizationHeader(
  headers: HeaderMap | undefined,
  token: string | null | undefined,
): HeaderMap {
  const next: HeaderMap = { ...(headers || {}) };
  if (hasAuthorizationHeader(next)) return next;
  const authorization = buildAuthorizationValue(token);
  if (authorization) next.Authorization = authorization;
  return next;
}

/** 从完整请求头中仅保留认证相关字段，用于发起签到请求。 */
export function pickAuthHeaders(source: HeaderMap): HeaderMap {
  const authKeys = ['authorization', 'cookie', 'session', 'token', 'x-token', 'x-auth', 'new-api'];
  const headers: HeaderMap = { 'Content-Type': 'application/json' };
  for (const [name, value] of Object.entries(source)) {
    const lower = name.toLowerCase();
    if (authKeys.some((k) => lower.includes(k))) headers[name] = value;
  }
  if (source['User-Agent']) headers['User-Agent'] = source['User-Agent'];
  if (source['Referer']) headers['Referer'] = source['Referer'];
  return headers;
}
