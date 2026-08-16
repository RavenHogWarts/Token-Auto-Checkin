/** cookie 认证策略：直接复用浏览器已有 cookie，不做登录动作（场景 A）。 */
import { browser } from '#imports';
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import type { SiteProfile } from '../../domain/site-profile';

export const cookieAuth: AuthStrategyImpl = {
  name: 'cookie',
  async resolve(profile: SiteProfile, _ctx: RunContext): Promise<AuthContext | null> {
    const cookies = await browser.cookies.getAll({ domain: profile.domain });
    if (cookies.length === 0) return { cookieOnly: true };
    const Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return { headers: { Cookie }, cookieOnly: true };
  },
};
