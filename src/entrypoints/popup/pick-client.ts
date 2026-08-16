/** 弹窗侧：请求后台开启页面元素点选。 */
import { browser } from '#imports';

export function sendStartPick(pageUrl?: string): Promise<{ success?: boolean } | undefined> {
  return browser.runtime.sendMessage({ type: 'site/start-pick', pageUrl }) as Promise<
    { success?: boolean } | undefined
  >;
}
