/**
 * 签到请求执行：background fetch 或标签页内 fetch（绕过 Cloudflare）。
 * 移植自 reference/background.js doFetchWithHeaders / doCheckInRequest。
 */
import { parseCheckInResponse, type ParsedCheckinResponse } from '../domain/checkin-result';
import { pickAuthHeaders, type HeaderMap } from '../shared/auth-headers';
import { isInvalidHttpStatus } from '../shared/url';
import type { AuthContext } from '../core/context';
import { runInTab } from './tabs';

type Method = 'GET' | 'POST';

/** 页面注入函数：在标签页上下文发起 fetch，返回原始文本。自包含。 */
function fetchInTab(
  url: string,
  method: string,
  params: Record<string, unknown> | undefined,
  headers: Record<string, string>,
): Promise<{ httpStatus: number; text?: string; invalidSite?: boolean; error?: string }> {
  const options: RequestInit = { method, headers, credentials: 'include' };
  if (method === 'POST' && params && Object.keys(params).length > 0) {
    options.body = JSON.stringify(params);
  }
  return fetch(url, options)
    .then(async (response) => {
      if (response.status === 404 || response.status === 410) {
        return { httpStatus: response.status, invalidSite: true };
      }
      const text = await response.text();
      return { httpStatus: response.status, text };
    })
    .catch((e: Error) => ({ httpStatus: 0, error: e.message }));
}

function parseText(
  raw: { httpStatus: number; text?: string; invalidSite?: boolean; error?: string },
  successOnHttpOk: boolean,
): ParsedCheckinResponse {
  if (raw.invalidSite) {
    return {
      success: false,
      alreadyCheckedIn: false,
      invalidSite: true,
      message: '站点页面失效',
      httpStatus: raw.httpStatus,
    };
  }
  if (raw.error !== undefined || raw.text === undefined) {
    return {
      success: false,
      alreadyCheckedIn: false,
      error: raw.error || '请求失败',
      message: raw.error || '请求失败',
      httpStatus: raw.httpStatus,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.text);
  } catch {
    return {
      success: false,
      alreadyCheckedIn: false,
      error: `Response is not JSON: ${raw.text.substring(0, 100)}`,
      message: '响应非 JSON',
      httpStatus: raw.httpStatus,
    };
  }
  return parseCheckInResponse(data, raw.httpStatus, successOnHttpOk);
}

/** background 侧直接 fetch */
export async function doFetchWithHeaders(
  url: string,
  method: Method,
  params: Record<string, unknown> | undefined,
  headers: HeaderMap,
  successOnHttpOk = false,
): Promise<ParsedCheckinResponse> {
  const finalHeaders = pickAuthHeaders(headers);
  const options: RequestInit = { method, headers: finalHeaders };
  if (method === 'POST' && params && Object.keys(params).length > 0) {
    options.body = JSON.stringify(params);
  }
  try {
    const response = await fetch(url, options);
    if (isInvalidHttpStatus(response.status)) {
      return {
        success: false,
        alreadyCheckedIn: false,
        invalidSite: true,
        message: '站点页面失效',
        httpStatus: response.status,
      };
    }
    const data = await response.json();
    return parseCheckInResponse(data, response.status, successOnHttpOk);
  } catch (e) {
    return {
      success: false,
      alreadyCheckedIn: false,
      error: (e as Error).message,
      message: (e as Error).message,
      httpStatus: 0,
    };
  }
}

/**
 * 发起签到请求：若 auth.needsTabExecution 且有可用 tabId，则在标签页内执行；否则 background fetch。
 */
export async function doCheckInRequest(
  auth: AuthContext,
  url: string,
  method: Method,
  params: Record<string, unknown> | undefined,
): Promise<ParsedCheckinResponse> {
  const headers = auth.headers || {};
  const successOnHttpOk = auth.successOnHttpOk === true;

  if (auth.needsTabExecution && auth.tabId) {
    const tabHeaders = pickAuthHeaders(headers);
    try {
      const raw = await runInTab(auth.tabId, fetchInTab, [url, method, params, tabHeaders]);
      if (raw) return parseText(raw, successOnHttpOk);
    } catch (e) {
      console.warn('[checkin-request] 标签页内执行失败，回退 background fetch:', e);
    }
  }
  return doFetchWithHeaders(url, method, params, headers, successOnHttpOk);
}
