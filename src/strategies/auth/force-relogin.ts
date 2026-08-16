/**
 * force-relogin 认证策略（场景 B）：每次签到前强制登出并重新 OAuth。
 * 清认证缓存 + 清站点 cookie（登出）+ 走 OAuth 拿到全新 session。
 */
import { browser } from '#imports';
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import type { SiteProfile } from '../../domain/site-profile';
import { clearCachedHeaders } from '../../services/storage';
import { resolveOAuthAuth } from './oauth-linuxdo';

/** 清除某域名下的全部 cookie（相当于登出） */
async function removeDomainCookies(domain: string): Promise<void> {
  const cookies = await browser.cookies.getAll({ domain });
  await Promise.all(
    cookies.map((c) => {
      const scheme = c.secure ? 'https' : 'http';
      const host = c.domain.replace(/^\./, '');
      const url = `${scheme}://${host}${c.path}`;
      return browser.cookies.remove({ url, name: c.name }).catch(() => undefined);
    }),
  );
}

export const forceReloginAuth: AuthStrategyImpl = {
  name: 'force-relogin',
  async resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null> {
    ctx.logger.log(`${profile.name} 强制重新登录：清缓存 + 登出`);
    await clearCachedHeaders(profile.id);
    await removeDomainCookies(profile.domain);
    return resolveOAuthAuth(profile, ctx);
  },
};
