/**
 * 从浏览器 cookie + 页面 session 构建 NewAPI 认证头。
 * 移植自 reference/newapi-auth.js buildNewApiExistingSessionHeaders / parseNewApiUserId。
 */
import { browser } from '#imports';
import type { HeaderMap } from '../../shared/auth-headers';
import { inspectBrowserSession, type BrowserSessionInfo } from '../../page/read-login-state';
import { runInTab } from '../../services/tabs';

function parseUserId(user: string | null): string | null {
  if (!user) return null;
  let parsed: unknown = user;
  try {
    parsed = JSON.parse(user);
  } catch {
    return null;
  }
  const p = parsed as Record<string, unknown> & { data?: Record<string, unknown> };
  return (
    (p?.id as string) ||
    (p?.user_id as string) ||
    (p?.data?.id as string) ||
    (p?.data?.user_id as string) ||
    null
  );
}

export interface SessionHeaderInput {
  cookies: chrome.cookies.Cookie[];
  session: BrowserSessionInfo | null;
  base?: HeaderMap;
}

export function buildSessionHeaders({ cookies, session, base }: SessionHeaderInput): HeaderMap {
  const headers: HeaderMap = { ...(base || {}) };
  if (!headers.Cookie && !headers.cookie && cookies.length > 0) {
    headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }
  const userId = parseUserId(session?.user ?? null);
  if (userId && !headers['New-API-User']) headers['New-API-User'] = String(userId);

  const token = session?.token;
  const hasAuth = Object.keys(headers).some((n) => n.toLowerCase() === 'authorization');
  if (token && !hasAuth) {
    headers.Authorization = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  }
  return headers;
}

/** 读取域名 cookie + 页面 session，构建 NewAPI 认证头 */
export async function readSessionHeaders(domain: string, tabId: number): Promise<HeaderMap | null> {
  const session = await runInTab(tabId, inspectBrowserSession, []);
  const cookies = await browser.cookies.getAll({ domain });
  const headers = buildSessionHeaders({ cookies, session: session ?? null, base: {} });
  if (!headers.Cookie && !headers.cookie && !headers.Authorization) return null;
  return headers;
}
