/** api 签到策略：向签到接口发请求；失败时按需重登 / 页面兜底。 */
import type { AuthContext, CheckinStrategyImpl, RunContext } from '../../core/context';
import { resolveBalance } from '../../core/balance';
import {
  shouldTryPageFallback,
  toCheckinResult,
  type ParsedCheckinResponse,
} from '../../domain/checkin-result';
import { buildHumanVerificationResult } from '../../domain/human-verification';
import type { CheckinResult } from '../../domain/checkin-result';
import type { SiteProfile } from '../../domain/site-profile';
import { doCheckInRequest } from '../../services/checkin-request';
import { refreshAuth } from '../auth';
import { pageClickCheckin } from './page-click';

function isCloudflareError(r: ParsedCheckinResponse): boolean {
  const err = r.error || '';
  return (
    (r.httpStatus === 403 && (err.includes('Just a moment') || err.includes('<!DOCTYPE html>'))) ||
    (err.includes('<!DOCTYPE') && err.includes('is not valid JSON'))
  );
}

export const apiCheckin: CheckinStrategyImpl = {
  name: 'api',
  async run(profile: SiteProfile, auth: AuthContext, ctx: RunContext): Promise<CheckinResult> {
    const api = profile.checkin.api;
    if (!api) return { status: 'failed', message: '未配置签到接口' };

    const reqAuth: AuthContext = { ...auth, successOnHttpOk: api.successOnHttpOk };
    let active = reqAuth;
    let execResult = await doCheckInRequest(reqAuth, api.execUrl, api.method, api.params);
    ctx.logger.log(`${profile.name} 签到响应:`, execResult.message);

    // 401 或 Cloudflare 拦截 → 重新登录后重试一次
    if (execResult.httpStatus === 401 || isCloudflareError(execResult)) {
      ctx.logger.log(`${profile.name} 认证失效，尝试重新登录...`);
      const refreshed = await refreshAuth(profile, ctx);
      if (refreshed?.securityCheck) return buildHumanVerificationResult();
      if (refreshed?.headers) {
        active = { ...refreshed, successOnHttpOk: api.successOnHttpOk, needsTabExecution: true };
        execResult = await doCheckInRequest(active, api.execUrl, api.method, api.params);
        ctx.logger.log(`${profile.name} 重新登录后重试响应:`, execResult.message);
      }
    }

    // 接口失败（非已签/失效）→ 官方页面点击兜底
    if (shouldTryPageFallback(execResult) && !execResult.requiresSecurityCheck) {
      ctx.logger.log(`${profile.name} 接口未成功，尝试页面兜底点击签到...`);
      const pageResult = await pageClickCheckin.run(profile, active, ctx);
      if (pageResult.status !== 'failed') return pageResult;
    }

    const result = toCheckinResult(execResult);
    if (result.status === 'success' || result.status === 'already' || result.status === 'failed') {
      const balance = await resolveBalance(profile, active, execResult, active.tabId);
      if (balance) result.balance = balance;
    }
    if (api.queryUrl && (result.status === 'success' || result.status === 'already')) {
      result.queryVerified = true;
    }
    return result;
  },
};
