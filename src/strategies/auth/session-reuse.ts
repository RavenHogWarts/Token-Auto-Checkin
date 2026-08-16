/** session-reuse 认证策略：探测登录态，有效则复用，无效升级到 OAuth。 */
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import { hasUserSession, inspectBrowserSession } from '../../page/read-login-state';
import { probeTab } from '../../services/human-verification';
import { getNewApiPostLoginUrl } from '../../domain/oauth-urls';
import type { SiteProfile } from '../../domain/site-profile';
import { resolveOAuthAuth } from './oauth-linuxdo';
import { readSessionHeaders } from './session-headers';
import { isTargetSiteLoginPage } from '../../shared/url';
import { getTab, runInTab } from '../../services/tabs';

export const sessionReuseAuth: AuthStrategyImpl = {
  name: 'session-reuse',
  async resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null> {
    const postLoginUrl = getNewApiPostLoginUrl(profile.domain, profile.checkin.pageUrl);
    const tab = await ctx.tabSession.open(postLoginUrl);
    const tabId = tab.id!;

    if (await probeTab(tabId)) return { securityCheck: true, tabId };

    const current = await getTab(tabId);
    if (current && isTargetSiteLoginPage(current.url || '', profile.domain)) {
      return resolveOAuthAuth(profile, ctx);
    }

    const session = await runInTab(tabId, inspectBrowserSession, []);
    if (session?.success && hasUserSession(session)) {
      const headers = await readSessionHeaders(profile.domain, tabId);
      if (headers) return { headers, tabId };
    }

    return resolveOAuthAuth(profile, ctx);
  },
};
