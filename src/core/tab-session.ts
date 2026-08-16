/**
 * 临时后台标签页会话。移植自 reference/background.js createSiteTabSession。
 * 后台打开、不抢焦点，会话内复用同一标签页，结束时关闭。
 */
import { browser } from '#imports';
import type { TabSession, TabSessionOpenOptions } from './context';
import { startMonitor } from '../services/human-verification';
import { closeTabQuietly, ensureTabPageReady } from '../services/tabs';

export async function createTemporaryBackgroundTab(
  url: string,
  timeout = 15000,
  options: TabSessionOpenOptions = {},
): Promise<chrome.tabs.Tab> {
  const tab = await browser.tabs.create({ url, active: options.active === true });
  if (tab.id) startMonitor(tab.id);
  try {
    return await ensureTabPageReady(tab.id!, url, timeout);
  } catch (e) {
    await closeTabQuietly(tab.id);
    throw e;
  }
}

export function createSiteTabSession(): TabSession {
  let tabId: number | null = null;

  return {
    owns(id) {
      return Boolean(tabId && id && tabId === id);
    },
    async open(url, timeout = 15000, options = {}) {
      if (tabId) {
        try {
          await browser.tabs.get(tabId);
        } catch {
          tabId = null;
        }
      }

      if (!tabId) {
        const tab = await createTemporaryBackgroundTab(url, timeout, options);
        tabId = tab.id!;
        return tab;
      }

      try {
        startMonitor(tabId);
        await browser.tabs.update(tabId, { url, active: options.active === true });
        return await ensureTabPageReady(tabId, url, timeout);
      } catch (e) {
        await closeTabQuietly(tabId);
        tabId = null;
        throw e;
      }
    },
    async close() {
      if (!tabId) return;
      const id = tabId;
      tabId = null;
      await closeTabQuietly(id);
    },
  };
}

/** 若标签页不属于当前会话则关闭它 */
export async function closeTabUnlessInSession(
  tabId: number | undefined,
  session: TabSession | null,
): Promise<void> {
  if (!tabId) return;
  if (session?.owns(tabId)) return;
  await closeTabQuietly(tabId);
}
