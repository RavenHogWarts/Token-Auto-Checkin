/**
 * webRequest 认证头嗅探：观察目标标签页发往站点 /api/ 的请求，捕获其认证头。
 *
 * 兼容两种 New API 认证模型：
 *  - rc.23（如 tabitoken）：access token 只在内存，页面用 `Authorization: Bearer` 发请求；
 *  - rc.21（如 gorouter）：`session` cookie + `New-Api-User` 头（无 Bearer）。
 * 两者共同点是「token/会话不落 localStorage」或需原样复用页面请求头，读存储/复用 cookie 不足，
 * 故观察页面自身请求，捕获 Authorization 或 New-Api-User。后续在标签页内 fetch 时
 * credentials:'include' 会自动带上 session/cf_clearance cookie。
 *
 * MV3 观察模式（非阻塞）下 onSendHeaders + extraHeaders 可读取 Authorization。
 */
import { browser } from '#imports';
import { sleep } from '../shared/time';
import type { HeaderMap } from '../shared/auth-headers';

/** 仅保留认证相关头，避免把无关请求头带进后续签到请求 */
const CAPTURE_KEYS = ['authorization', 'new-api-user', 'x-token', 'x-auth'];

function pickCaptured(requestHeaders: chrome.webRequest.HttpHeader[] | undefined): HeaderMap {
  const map: HeaderMap = {};
  for (const h of requestHeaders || []) {
    if (!h.value) continue;
    const lower = h.name.toLowerCase();
    if (CAPTURE_KEYS.some((k) => lower === k || lower.includes(k))) map[h.name] = h.value;
  }
  return map;
}

function hasAuthMarker(map: HeaderMap): boolean {
  // 两种 New API 认证模型任满足其一即可捕获：
  //  - rc.23（内存 token）：Authorization: Bearer
  //  - rc.21（会话 cookie）：New-Api-User 头（session cookie 由 credentials:include 自动带上）
  return Object.keys(map).some((n) => {
    const lower = n.toLowerCase();
    return lower === 'authorization' || lower === 'new-api-user';
  });
}

/**
 * 打开/刷新目标标签页后，捕获其发往 https://{domain}/api/* 的首个带 Authorization 的请求头。
 * 捕获成功返回认证头（含 Authorization），超时返回 null。
 */
export function captureAuthHeaders(
  domain: string,
  tabId: number,
  options: { timeoutMs?: number; reload?: boolean } = {},
): Promise<HeaderMap | null> {
  const { timeoutMs = 25000, reload = true } = options;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (headers: HeaderMap | null): void => {
      if (resolved) return;
      resolved = true;
      try {
        browser.webRequest.onSendHeaders.removeListener(listener);
      } catch {
        /* ignore */
      }
      resolve(headers);
    };

    // 用最小结构类型标注，避免依赖 @types/chrome 未导出的 OnSendHeadersDetails
    const listener = (details: {
      tabId: number;
      requestHeaders?: chrome.webRequest.HttpHeader[];
    }): void => {
      if (resolved || details.tabId !== tabId) return;
      const map = pickCaptured(details.requestHeaders);
      if (!hasAuthMarker(map)) return; // 等到真正带认证标记（Authorization / New-Api-User）的请求
      finish(map);
    };

    try {
      browser.webRequest.onSendHeaders.addListener(
        listener,
        { urls: [`https://${domain}/api/*`], tabId },
        ['requestHeaders', 'extraHeaders'],
      );
    } catch (e) {
      console.warn('[capture-headers] 注册监听失败:', e);
      resolve(null);
      return;
    }

    void (async () => {
      // 刷新页面以触发前端重新拉取 token 并发出带 Authorization 的 /api 请求
      if (reload) {
        try {
          await browser.tabs.reload(tabId);
        } catch (e) {
          console.warn('[capture-headers] 刷新标签页失败:', e);
        }
      }
      await sleep(timeoutMs);
      finish(null);
    })();
  });
}
