/**
 * chrome.tabs / scripting 低层封装。移植自 reference/background.js 的等待与注入工具。
 */
import { browser } from '#imports';
import { sleep } from '../shared/time';
import { isInvalidTabUrl, createInvalidSiteError } from '../shared/url';

export const PAGE_USABLE_TIMEOUT_MS = 20000;

/** 在指定标签页执行自包含函数并返回其结果（自动 await 异步函数的返回值） */
export async function runInTab<Args extends unknown[], R>(
  tabId: number,
  func: (...args: Args) => R,
  args: Args,
): Promise<Awaited<R> | undefined> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: func as any,
    args: args as unknown[],
  });
  return results[0]?.result as Awaited<R> | undefined;
}

export function waitForTabComplete(tabId: number, timeout = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(listener);
      resolve(val);
    };
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs
      .get(tabId)
      .then((t) => {
        if (t.status === 'complete') finish(true);
      })
      .catch(() => finish(false));
    setTimeout(() => finish(false), timeout);
  });
}

export function waitForTabUrlMatch(tabId: number, domain: string, timeout = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(listener);
      resolve(val);
    };
    const listener = (id: number, _info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && tab.url && tab.url.includes(domain)) finish(true);
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs
      .get(tabId)
      .then((t) => {
        if (t.url && t.url.includes(domain)) finish(true);
      })
      .catch(() => {});
    setTimeout(() => finish(false), timeout);
  });
}

export function waitForTabUrlChange(
  tabId: number,
  previousUrl: string,
  timeout = 10000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(listener);
      resolve(val);
    };
    const listener = (id: number, _info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && tab.url && tab.url !== previousUrl) finish(true);
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs
      .get(tabId)
      .then((t) => {
        if (t.url && t.url !== previousUrl) finish(true);
      })
      .catch(() => {});
    setTimeout(() => finish(false), timeout);
  });
}

/** 检测页面是否已渲染出可见内容（非空白） */
export async function waitForUsableTabPage(
  tabId: number,
  timeout = PAGE_USABLE_TIMEOUT_MS,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const usable = await runInTab(tabId, pageUsableProbe, []);
      if (usable) return true;
    } catch {
      // 注入失败（如权限/跨域受限）时不阻塞流程
      return true;
    }
    await sleep(500);
  }
  return false;
}

/** 页面注入函数：判断页面是否有可见内容 */
function pageUsableProbe(): boolean {
  const body = document.body;
  if (!body) return false;
  const text = (body.innerText || '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return true;
  const selectors = [
    'button',
    'input',
    'textarea',
    'select',
    'a[href]',
    '[role="button"]',
    '[onclick]',
    'iframe',
    'canvas',
    'svg',
    'img[src]',
    'video',
    '[class*="spinner"]',
    '[class*="loading"]',
    '[class*="skeleton"]',
  ].join(', ');
  return Array.from(document.querySelectorAll(selectors)).some((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    );
  });
}

export async function ensureTabPageReady(
  tabId: number,
  url: string,
  timeout = 15000,
): Promise<chrome.tabs.Tab> {
  const loaded = await waitForTabComplete(tabId, timeout);
  let tabInfo = await browser.tabs.get(tabId);
  if (isInvalidTabUrl(tabInfo.url)) throw createInvalidSiteError(url || tabInfo.url);
  if (!loaded) throw new Error('页面加载超时');

  const usable = await waitForUsableTabPage(tabId, PAGE_USABLE_TIMEOUT_MS);
  tabInfo = await browser.tabs.get(tabId);
  if (isInvalidTabUrl(tabInfo.url)) throw createInvalidSiteError(url || tabInfo.url);
  if (!usable) throw new Error('页面空白或无响应');
  return tabInfo;
}

export async function closeTabQuietly(tabId: number | undefined): Promise<void> {
  if (!tabId) return;
  try {
    await browser.tabs.remove(tabId);
  } catch {
    /* already closed */
  }
}

export async function focusTabWindow(tabId: number | undefined): Promise<void> {
  if (!tabId) return;
  try {
    const tab = await browser.tabs.update(tabId, { active: true });
    const windowId = tab?.windowId;
    if (windowId !== undefined && browser.windows?.update) {
      await browser.windows.update(windowId, { focused: true });
    }
  } catch (e) {
    console.warn('[tabs] 前置窗口失败:', e);
  }
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return null;
  }
}
