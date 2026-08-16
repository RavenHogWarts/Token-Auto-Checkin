/**
 * 各站点 OAuth / 登录相关 URL 构建与判断。
 * 移植自 reference/newapi-auth.js、sub2api-auth.js、zenapi-auth.js。
 */
import { hasOAuthCallbackCredential, isTargetSiteLoginPage } from '../shared/url';

/* ============ NewAPI ============ */
export function getNewApiPostLoginUrl(domain: string, visitUrl?: string): string {
  return visitUrl || `https://${domain}/console/personal`;
}

export function buildNewApiLinuxDoOAuthUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, state });
  return `https://connect.linux.do/oauth2/authorize?${params.toString()}`;
}

export function isNewApiOAuthCallbackUrl(url: string): boolean {
  try {
    return new URL(url || '').searchParams.has('code');
  } catch {
    return false;
  }
}

/* ============ Sub2API ============ */
export function getSub2ApiOAuthRedirect(currentUrl = ''): string {
  try {
    const parsed = new URL(currentUrl || '');
    const redirect = parsed.searchParams.get('redirect');
    if (redirect && redirect.startsWith('/')) return redirect;
    if (parsed.pathname && !/^\/login(?:\/|$)/i.test(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}` || '/check-in';
    }
    return '/check-in';
  } catch {
    return '/check-in';
  }
}

export function buildSub2ApiLinuxDoOAuthStartUrl(domain: string, visitUrl?: string): string {
  const redirect = getSub2ApiOAuthRedirect(visitUrl);
  const params = new URLSearchParams({ redirect });
  return `https://${domain}/api/v1/auth/oauth/linuxdo/start?${params.toString()}`;
}

export function getSub2ApiPostLoginUrl(domain: string, visitUrl?: string): string {
  return `https://${domain}${getSub2ApiOAuthRedirect(visitUrl)}`;
}

export function isSub2ApiTargetLoginPage(url: string, domain: string): boolean {
  return isTargetSiteLoginPage(url, domain);
}

/* ============ ZenAPI ============ */
export function buildZenApiLoginUrl(domain: string): string {
  return `https://${domain}/api/u/auth/linuxdo`;
}

export function getZenApiPostLoginUrl(domain: string): string {
  return `https://${domain}/user`;
}

export function extractZenApiLinuxDoToken(url: string): string | null {
  try {
    return new URL(url).searchParams.get('linuxdo_token');
  } catch {
    return null;
  }
}

export function isZenApiTargetLoginPage(url: string, domain: string): boolean {
  return isTargetSiteLoginPage(url, domain) && !hasOAuthCallbackCredential(url, ['linuxdo_token']);
}
