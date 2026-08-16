/** 单站签到流水线：Auth → Checkin（含内部兜底）→ 标注策略。见 dev/04-架构设计.md 第 3 节。 */
import type { CheckinResult } from '../domain/checkin-result';
import { buildHumanVerificationResult } from '../domain/human-verification';
import type { SiteProfile } from '../domain/site-profile';
import { getCheckinStrategy } from '../strategies/checkin';
import { resolveAuth } from '../strategies/auth';
import type { AuthContext, RunContext } from './context';
import { isCancelRequested } from './context';
import { isInvalidSiteError } from '../shared/url';

export async function runSiteCheckin(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<CheckinResult> {
  try {
    ctx.logger.log(`认证阶段开始，策略=${profile.auth.strategy}`);
    const auth = await resolveAuth(profile, ctx);
    if (auth?.securityCheck) {
      ctx.logger.warn('检测到人机验证，需人工处理');
      return buildHumanVerificationResult();
    }
    if (isCancelRequested(ctx.cancelToken)) return { status: 'failed', message: '签到中断' };

    const strategy = profile.checkin.strategy;
    ctx.logger.log(
      `认证结果：${auth ? (auth.headers ? '已取得认证头' : auth.cookieOnly ? '使用 cookie 会话' : '已就绪') : '未获登录态'}`,
    );
    // visit / page-click / manual-assist 可在无显式认证头时用 cookie 继续
    const canProceedWithoutAuth = strategy !== 'api';
    if (!auth && !canProceedWithoutAuth) {
      return { status: 'failed', message: '无法获取登录态，签到失败' };
    }

    const effectiveAuth: AuthContext = auth ?? { cookieOnly: true };
    ctx.logger.log(`签到阶段开始，策略=${strategy}，页面=${profile.checkin.pageUrl}`);
    const result = await getCheckinStrategy(strategy).run(profile, effectiveAuth, ctx);
    result.strategyUsed = { auth: profile.auth.strategy, checkin: strategy };
    return result;
  } catch (e) {
    if (isInvalidSiteError(e)) return { status: 'invalid', message: '站点页面失效' };
    return { status: 'failed', message: (e as Error).message };
  }
}
