/** 认证策略注册表 + 带缓存的统一入口。见 dev/04-架构设计.md 第 3.2 节。 */
import type { AuthContext, AuthStrategyImpl, RunContext } from '../../core/context';
import type { AuthStrategy, SiteProfile } from '../../domain/site-profile';
import { cacheHeaders, clearCachedHeaders, getCachedHeaders } from '../../services/storage';
import { bearerSniffAuth } from './bearer-sniff';
import { cookieAuth } from './cookie';
import { forceReloginAuth } from './force-relogin';
import { sessionReuseAuth } from './session-reuse';
import { tokenStorageAuth } from './token-storage';
import { resolveOAuthAuth } from './oauth-linuxdo';

const oauthAuth: AuthStrategyImpl = { name: 'oauth-linuxdo', resolve: resolveOAuthAuth };

const registry = new Map<AuthStrategy, AuthStrategyImpl>();

export function registerAuthStrategy(impl: AuthStrategyImpl): void {
  registry.set(impl.name, impl);
}

[cookieAuth, sessionReuseAuth, tokenStorageAuth, oauthAuth, forceReloginAuth, bearerSniffAuth].forEach(
  registerAuthStrategy,
);

export function getAuthStrategy(name: AuthStrategy): AuthStrategyImpl {
  return registry.get(name) ?? cookieAuth;
}

/**
 * 统一认证入口：force-relogin 跳过缓存；其余优先命中 7 天缓存；
 * 成功拿到认证头后写回缓存。
 */
export async function resolveAuth(
  profile: SiteProfile,
  ctx: RunContext,
  options: { forceRefresh?: boolean } = {},
): Promise<AuthContext | null> {
  const strategy = profile.auth.strategy;
  const needsTabExecution = profile.preset === 'zenapi';

  // force-relogin 每次强制重登；bearer-sniff 的 token 短时有效（约 15 分钟）——两者都不吃缓存
  const skipCache = strategy === 'force-relogin' || strategy === 'bearer-sniff';
  if (!skipCache && !options.forceRefresh) {
    const cached = await getCachedHeaders(profile.id);
    if (cached) {
      ctx.logger.log(`${profile.name} 使用缓存认证头`);
      return { headers: cached, needsTabExecution };
    }
  }

  const result = await getAuthStrategy(strategy).resolve(profile, ctx);
  if (result?.headers && !result.securityCheck && strategy !== 'cookie' && !skipCache) {
    await cacheHeaders(profile.id, result.headers);
  }
  return result;
}

/** 认证失效后重新获取（清缓存 + 强制刷新） */
export async function refreshAuth(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<AuthContext | null> {
  await clearCachedHeaders(profile.id);
  return resolveAuth(profile, ctx, { forceRefresh: true });
}
