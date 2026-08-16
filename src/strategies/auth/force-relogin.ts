/**
 * force-relogin 认证策略（场景 B）：每次签到前「彻底登出」再重新 OAuth。
 * 彻底登出 = 调站点官方登出接口下发空 session + 清 localStorage/sessionStorage 登录态 + 清站点 cookie，
 * 然后走 OAuth 拿到全新 session。
 *
 * 注：agentrouter 等 New API / One API 站点 session 为无状态 cookie-store（登录态编码在 session cookie 里，
 * 服务端无 session 存储可撤销），故删 cookie + 清 localStorage 即等价于点页面上的「退出」。
 * 仅删 cookie 而不清 localStorage 时，前端仍据 localStorage.user 判定已登录，导致「登出不彻底」。
 */
import { browser } from '#imports';
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import type { SiteProfile } from '../../domain/site-profile';
import { performSiteLogout } from '../../page/site-logout';
import { clearCachedHeaders } from '../../services/storage';
import { runInTab } from '../../services/tabs';
import { resolveOAuthAuth } from './oauth-linuxdo';

/** 清除某域名下的全部 cookie（含登出后服务端下发的空 session） */
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

/** 在站点标签页内执行官方登出接口 + 清本地登录态（localStorage / sessionStorage） */
async function logoutInTab(profile: SiteProfile, ctx: RunContext): Promise<void> {
  const tab = await ctx.tabSession.open(`https://${profile.domain}/`);
  const result = await runInTab(tab.id!, performSiteLogout, [
    {
      logoutPaths: ['/api/user/logout'],
      userKeys: ['user'],
      tokenKeys: profile.auth.tokenKeys ?? ['token', 'access_token', 'auth_token'],
    },
  ]);
  ctx.logger.log(
    `${profile.name} 站内登出：接口=${result?.logoutStatus ?? 'n/a'} 清除本地键=${
      result?.clearedKeys?.join(',') || '无'
    }`,
  );
}

export const forceReloginAuth: AuthStrategyImpl = {
  name: 'force-relogin',
  async resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null> {
    ctx.logger.log(`${profile.name} 彻底登出并重新登录`);
    await clearCachedHeaders(profile.id);

    // 1) 站内登出：官方接口 + 清 localStorage/sessionStorage（缺这步前端仍判定已登录 → 登出不彻底）
    try {
      await logoutInTab(profile, ctx);
    } catch (e) {
      ctx.logger.warn(`${profile.name} 站内登出失败，改用清 cookie 兜底`, e);
    }

    // 2) 删站点 cookie（无状态 session 随 cookie 一并失效）
    await removeDomainCookies(profile.domain);

    // 3) 重新 OAuth（复用同一标签页会话，拿到全新 session）
    return resolveOAuthAuth(profile, ctx);
  },
};
