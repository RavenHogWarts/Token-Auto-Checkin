/** page-click 签到策略（场景 C）：打开页面查找并点击签到按钮，捕获结果。 */
import type { AuthContext, CheckinStrategyImpl, RunContext } from '../../core/context';
import { resolveBalance } from '../../core/balance';
import {
  parseCheckInResponse,
  toCheckinResult,
  type CheckinResult,
  type ParsedCheckinResponse,
} from '../../domain/checkin-result';
import { getHumanVerificationProbeConfig } from '../../domain/human-verification';
import type { SiteProfile } from '../../domain/site-profile';
import { runPageCheckin, type PageCheckinResult } from '../../page/run-page-checkin';
import { getFocusHumanVerificationWindow } from '../../services/storage';
import { focusTabWindow, getTab, runInTab } from '../../services/tabs';
import { sleep } from '../../shared/time';
import { isInvalidTabUrl } from '../../shared/url';

function isLoginishUrl(url: string): boolean {
  return /\/(login|sign-in|signin)(\/|$)|connect\.linux\.do|oauth|authorize/i.test(url || '');
}

async function mapPageResult(
  profile: SiteProfile,
  auth: AuthContext,
  page: PageCheckinResult,
  tabId: number,
  keepTabForManual: boolean,
): Promise<CheckinResult> {
  const successOnHttpOk = profile.checkin.api?.successOnHttpOk === true;

  const needsHuman = async (message: string): Promise<CheckinResult> => {
    if (keepTabForManual || (await getFocusHumanVerificationWindow())) await focusTabWindow(tabId);
    return { status: 'needs-human', message, requiresManual: true };
  };

  let execResult: ParsedCheckinResponse | null = null;
  let result: CheckinResult;

  if (page.kind === 'response' && page.data) {
    execResult = parseCheckInResponse(page.data, page.httpStatus ?? 200, successOnHttpOk);
    if (execResult.requiresSecurityCheck) return needsHuman('站点要求完成安全验证，自动签到已停止');
    result = toCheckinResult(execResult);
  } else if (page.kind === 'already') {
    result = { status: 'already', message: page.message || '今日已签到' };
  } else if (page.kind === 'success') {
    result = { status: 'success', message: page.message || '签到成功' };
  } else if (page.kind === 'security-check') {
    return needsHuman(page.message || '站点要求完成人机验证，自动签到已停止');
  } else {
    // no-button / timeout
    if (keepTabForManual) return needsHuman(page.message || '未能自动签到，请手动完成');
    result = { status: 'failed', message: page.message || '未找到签到按钮，自动签到失败' };
  }

  const balance = await resolveBalance(profile, auth, execResult, tabId);
  if (balance) result.balance = balance;
  return result;
}

export const pageClickCheckin: CheckinStrategyImpl = {
  name: 'page-click',
  async run(profile: SiteProfile, auth: AuthContext, ctx: RunContext): Promise<CheckinResult> {
    const url = profile.checkin.pageUrl;
    const click = profile.checkin.click ?? {};
    const openForeground = click.keepTabForManual === true;

    // 若认证阶段已打开可复用的标签页则复用，否则新开
    let tabId = auth.tabId;
    if (!tabId) {
      const tab = await ctx.tabSession.open(url, 20000, { active: openForeground });
      tabId = tab.id!;
    }
    if (openForeground) await focusTabWindow(tabId);
    await sleep(3000);

    const info = await getTab(tabId);
    if (!info || isInvalidTabUrl(info.url)) return { status: 'invalid', message: '站点页面失效' };

    const currentUrl = info.url || url;
    const page = await runInTab(tabId, runPageCheckin, [
      {
        targetUrl: profile.checkin.api?.execUrl || url,
        steps: click.steps,
        stepDelayMs: click.stepDelayMs,
        selectors: click.selectors,
        textPatterns: click.textPatterns,
        navSteps: click.navSteps,
        navStepDelayMs: click.navStepDelayMs,
        humanVerification: getHumanVerificationProbeConfig(),
        cleanupOrdinaryDialogs: !isLoginishUrl(currentUrl),
        skipOrdinaryDialogCleanup: isLoginishUrl(currentUrl),
      },
    ]);
    ctx.logger.log(`${profile.name} 页面签到结果:`, page?.kind);

    if (!page) return { status: 'failed', message: '页面签到脚本未返回结果' };
    return mapPageResult(profile, auth, page, tabId, click.keepTabForManual === true);
  },
};

