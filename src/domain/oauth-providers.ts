/**
 * OAuth 登录提供方规格。
 * 「重新登录」不一定走 linux.do，也可能是 GitHub 等第三方登录入口；
 * 差异集中在：点哪个登录按钮、授权页在哪个域名、需要哪个提供方的登录 cookie。
 */
import type { OAuthProvider } from './site-profile';
import { buildNewApiGithubOAuthUrl, buildNewApiLinuxDoOAuthUrl } from './oauth-urls';

export interface OAuthProviderSpec {
  id: OAuthProvider;
  label: string;
  /** 站点登录页上「用 X 登录」按钮的文案/属性匹配正则源 */
  loginButtonPatternSource: string;
  /** 第三方授权页所在的 host（用于识别「已跳到授权页，去点允许」） */
  authorizeHosts: string[];
  /** 该提供方的登录态 cookie 域名（用于预检是否已登录） */
  cookieDomain: string;
  /** /api/status 中该提供方 client_id 的字段名（NewAPI 直连快捷路径用；缺则回退登录页点击） */
  clientIdStatusKey?: string;
  /** 获取 OAuth state 的接口路径（含 query）。GitHub 需 ?mode=login，linux.do 用裸路径 */
  stateUrl?: string;
  /** 由 client_id + state 构建第三方授权 URL（NewAPI 直连快捷路径用） */
  buildAuthorizeUrl?: (clientId: string, state: string) => string;
}

export const OAUTH_PROVIDERS: Record<OAuthProvider, OAuthProviderSpec> = {
  linuxdo: {
    id: 'linuxdo',
    label: 'Linux.do',
    loginButtonPatternSource: 'linux\\s*\\.?\\s*do|linuxdo|使用.*linux|linux.*登录|登录.*linux',
    authorizeHosts: ['connect.linux.do'],
    cookieDomain: 'linux.do',
    clientIdStatusKey: 'linuxdo_client_id',
    stateUrl: '/api/oauth/state',
    buildAuthorizeUrl: buildNewApiLinuxDoOAuthUrl,
  },
  github: {
    id: 'github',
    label: 'GitHub',
    loginButtonPatternSource: 'github|use github|sign in with github|使用.*github|github.*登录|登录.*github',
    authorizeHosts: ['github.com'],
    cookieDomain: 'github.com',
    clientIdStatusKey: 'github_client_id',
    stateUrl: '/api/oauth/state?mode=login',
    buildAuthorizeUrl: buildNewApiGithubOAuthUrl,
  },
};

export function getProviderSpec(provider: OAuthProvider | undefined): OAuthProviderSpec {
  return OAUTH_PROVIDERS[provider ?? 'linuxdo'] ?? OAUTH_PROVIDERS.linuxdo;
}
