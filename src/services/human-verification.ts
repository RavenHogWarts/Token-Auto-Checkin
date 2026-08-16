/**
 * 人机验证探测与「前置窗口交人工」。
 * 简化自 reference/background.js 的监控逻辑：提供按需探测 + 轻量轮询监控。
 * 注意：service worker 可能被回收，监控为尽力而为，权威判断走按需 probeTab。
 */
import { browser } from '#imports';
import { getHumanVerificationProbeConfig } from '../domain/human-verification';
import { probeHumanVerification } from '../page/detect-human-verification';
import type { HumanVerificationProbeResult } from '../page/detect-human-verification';
import { getFocusHumanVerificationWindow, getProfile } from './storage';
import { focusTabWindow, getTab, runInTab } from './tabs';
import { isInvalidTabUrl } from '../shared/url';

const monitors = new Map<number, ReturnType<typeof setInterval>>();
const POLL_MS = 1500;
const MONITOR_MS = 120000;

/** 按需探测某标签页是否存在人机验证；命中且开关开启则前置窗口。 */
export async function probeTab(tabId: number): Promise<HumanVerificationProbeResult | null> {
  const tab = await getTab(tabId);
  if (!tab || isInvalidTabUrl(tab.url)) return null;
  try {
    const result = await runInTab(tabId, probeHumanVerification, [
      getHumanVerificationProbeConfig(),
    ]);
    if (!result?.detected) return null;
    await maybeFocus(tabId);
    return result;
  } catch {
    return null;
  }
}

async function maybeFocus(tabId: number): Promise<void> {
  if (await getFocusHumanVerificationWindow()) {
    await focusTabWindow(tabId);
  }
}

export function startMonitor(tabId: number): void {
  if (monitors.has(tabId)) return;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt > MONITOR_MS) {
      stopMonitor(tabId);
      return;
    }
    void probeTab(tabId);
  }, POLL_MS);
  monitors.set(tabId, timer);
}

export function stopMonitor(tabId: number): void {
  const timer = monitors.get(tabId);
  if (timer) clearInterval(timer);
  monitors.delete(tabId);
}

/** 处理页面注入脚本发来的「检测到人机验证」事件。 */
export async function handleDetectedMessage(
  sender: chrome.runtime.MessageSender,
): Promise<{ success: boolean; focused: boolean }> {
  const tabId = sender?.tab?.id;
  if (!tabId) return { success: false, focused: false };
  if (!(await getFocusHumanVerificationWindow())) return { success: true, focused: false };
  await focusTabWindow(tabId);
  return { success: true, focused: true };
}

/** 激活某站点仍打开着的手动标签页（needs-human 场景「去完成」）。 */
export async function activateManualTab(siteId: string): Promise<boolean> {
  const profile = await getProfile(siteId);
  if (!profile) return false;
  const tabs = await browser.tabs.query({});
  const match = tabs.find((t) => t.url?.includes(profile.domain));
  if (match?.id) {
    await focusTabWindow(match.id);
    return true;
  }
  return false;
}

browser.tabs.onRemoved.addListener((tabId) => {
  stopMonitor(tabId);
});
