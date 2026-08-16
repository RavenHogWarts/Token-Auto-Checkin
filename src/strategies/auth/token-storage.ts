/** token-storage 认证策略：从页面 storage 读取 token，读不到升级到 OAuth。 */
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import { probeTab } from '../../services/human-verification';
import { readTokenFromStorage } from '../../page/read-token';
import type { SiteProfile } from '../../domain/site-profile';
import { resolveOAuthAuth } from './oauth-linuxdo';
import { mergeAuthorizationHeader } from '../../shared/auth-headers';
import { runInTab } from '../../services/tabs';

export const tokenStorageAuth: AuthStrategyImpl = {
  name: 'token-storage',
  async resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null> {
    const tab = await ctx.tabSession.open(profile.checkin.pageUrl);
    const tabId = tab.id!;

    if (await probeTab(tabId)) return { securityCheck: true, tabId };

    const keys = profile.auth.tokenKeys ?? ['auth_token', 'access_token', 'token', 'user_token'];
    const token = await runInTab(tabId, readTokenFromStorage, [keys]);
    if (token) {
      return {
        headers: mergeAuthorizationHeader({}, token),
        tabId,
        needsTabExecution: profile.preset === 'zenapi',
      };
    }

    return resolveOAuthAuth(profile, ctx);
  },
};
