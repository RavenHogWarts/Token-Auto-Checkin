/**
 * bearer-sniff 认证策略：打开签到页，观察页面自身发往 /api/ 的请求，捕获其
 * Authorization: Bearer 头（New API rc.23：access token 仅在内存、由前端注入）。
 * 页面处于登录页则先走 OAuth 登录再嗅探。捕获到即返回「需在标签页内执行」的认证上下文。
 */
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import type { SiteProfile } from '../../domain/site-profile';
import { captureAuthHeaders } from '../../services/capture-headers';
import { probeTab } from '../../services/human-verification';
import { getTab } from '../../services/tabs';
import { isTargetSiteLoginPage } from '../../shared/url';
import { resolveOAuthAuth } from './oauth-linuxdo';

export const bearerSniffAuth: AuthStrategyImpl = {
  name: 'bearer-sniff',
  async resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null> {
    const { domain } = profile;
    const tab = await ctx.tabSession.open(profile.checkin.pageUrl);
    const tabId = tab.id!;

    if (await probeTab(tabId)) return { securityCheck: true, tabId };

    // 未登录（停在登录页）→ 先 OAuth 登录，成功后回到本标签页再嗅探
    const current = await getTab(tabId);
    if (current && isTargetSiteLoginPage(current.url || '', domain)) {
      ctx.logger.log(`${profile.name} 处于登录页，先走 OAuth 登录`);
      const oauth = await resolveOAuthAuth(profile, ctx);
      if (!oauth) return null;
      if (oauth.securityCheck) return oauth;
    }

    ctx.logger.log(`${profile.name} 嗅探页面认证头（Authorization / New-Api-User）…`);
    const headers = await captureAuthHeaders(domain, tabId, { timeoutMs: 25000 });
    if (!headers) {
      ctx.logger.warn(`${profile.name} 未能捕获认证头（页面可能未登录或未发起 API 请求）`);
      return null;
    }
    ctx.logger.log(`${profile.name} 已捕获认证头，将在标签页内执行签到`);
    // token 短时有效（约 15 分钟），且站点通常有 Cloudflare → 在标签页内执行
    return { headers, tabId, needsTabExecution: true };
  },
};
