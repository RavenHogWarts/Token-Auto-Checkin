/** 后台：页面元素点选流程（打开页面 → 注入点选器 → 收集选择器）。 */
import { browser } from '#imports';
import { startElementPicker } from '../page/element-picker';
import { appendPickResult } from './storage';
import { ensureTabPageReady, focusTabWindow, runInTab } from './tabs';

let pickTabId: number | null = null;
let openedByUs = false;

/**
 * 开启元素点选：优先在**当前活动标签页**注入（用户已在目标站点上），
 * 仅当活动页不可用（非 http/https）时才用 pageUrl 新开一个页面。
 */
export async function startElementPick(pageUrl?: string): Promise<{ success: boolean }> {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const usable = active?.id != null && /^https?:/i.test(active.url ?? '');
  openedByUs = false;

  if (usable && active?.id != null) {
    pickTabId = active.id;
  } else if (pageUrl) {
    const tab = await browser.tabs.create({ url: pageUrl, active: true });
    pickTabId = tab.id ?? null;
    openedByUs = true;
    if (pickTabId != null) {
      try {
        await ensureTabPageReady(pickTabId, pageUrl, 20000);
      } catch {
        /* 仍尝试注入 */
      }
    }
  } else {
    return { success: false };
  }

  if (pickTabId == null) return { success: false };
  await focusTabWindow(pickTabId);
  await runInTab(pickTabId, startElementPicker, []);
  return { success: true };
}

export async function recordPickedElement(selector: string): Promise<void> {
  await appendPickResult(selector);
}

export async function finishElementPick(): Promise<void> {
  // 仅关闭由本流程新开的标签页；用户原有页面不动
  if (pickTabId != null && openedByUs) {
    try {
      await browser.tabs.remove(pickTabId);
    } catch {
      /* 已关闭 */
    }
  }
  pickTabId = null;
  openedByUs = false;
}
