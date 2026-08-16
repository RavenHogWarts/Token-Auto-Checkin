/** visit 签到策略（场景 A）：仅带 cookie 打开页面，读余额视为成功。 */
import { browser } from '#imports';
import type { AuthContext, CheckinStrategyImpl, RunContext } from '../../core/context';
import { extractBalanceFromText } from '../../domain/balance';
import { buildHumanVerificationResult } from '../../domain/human-verification';
import type { CheckinResult } from '../../domain/checkin-result';
import type { SiteProfile } from '../../domain/site-profile';
import { readPageContent } from '../../page/read-page-content';
import { probeTab } from '../../services/human-verification';
import { ensureTabPageReady, getTab, runInTab } from '../../services/tabs';
import { sleep } from '../../shared/time';
import { isInvalidTabUrl } from '../../shared/url';

export const visitCheckin: CheckinStrategyImpl = {
  name: 'visit',
  async run(profile: SiteProfile, _auth: AuthContext, ctx: RunContext): Promise<CheckinResult> {
    const url = profile.checkin.pageUrl;
    const tab = await ctx.tabSession.open(url, 20000);
    const tabId = tab.id!;
    await sleep(3000);

    if (await probeTab(tabId)) return buildHumanVerificationResult();

    const info = await getTab(tabId);
    if (!info || isInvalidTabUrl(info.url)) return { status: 'invalid', message: '站点页面失效' };

    // 刷新以读取最新余额
    try {
      await browser.tabs.reload(tabId);
      await ensureTabPageReady(tabId, url, 20000);
      await sleep(1000);
    } catch {
      /* ignore refresh failure */
    }

    const page = await runInTab(tabId, readPageContent, [profile.preset === 'sub2api']);
    if (!page || isInvalidTabUrl(page.url)) return { status: 'invalid', message: '站点页面失效' };
    const loaded = page.readyState === 'complete' || page.readyState === 'interactive';
    if (!loaded) return { status: 'failed', message: '页面未完成加载' };

    const result: CheckinResult = { status: 'success', message: '已访问' };
    const balance = extractBalanceFromText(page.bodyText);
    if (balance) result.balance = balance;
    return result;
  },
};
