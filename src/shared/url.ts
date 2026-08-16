/**
 * URL 解析与推导工具。
 * 移植自 reference/page-automation.js、page-status.js、site-url.js。
 */

const OAUTH_CALLBACK_CREDENTIAL_PARAMS = [
  'code',
  'token',
  'access_token',
  'auth_token',
  'id_token',
  'linuxdo_token',
  'user_token',
];

const LOGIN_ROUTE_PATTERN = /^\/(?:login|sign-in|signin)(?:\/|$)/i;

export function normalizeTargetDomain(domain: string | undefined): string {
  try {
    if (!domain) return '';
    const value = String(domain).trim().toLowerCase();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return new URL(value).hostname.toLowerCase();
    return value.replace(/\/.*$/, '');
  } catch {
    return String(domain || '')
      .trim()
      .toLowerCase();
  }
}

export function hasOAuthCallbackCredential(url: string, extraParams: string[] = []): boolean {
  try {
    const parsed = new URL(url || '');
    const params = new Set(
      [...OAUTH_CALLBACK_CREDENTIAL_PARAMS, ...extraParams].map((n) => n.toLowerCase()),
    );
    for (const [name, value] of parsed.searchParams.entries()) {
      if (params.has(name.toLowerCase()) && String(value || '').trim() !== '') return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isTargetSiteLoginPage(url: string, domain: string, extraParams: string[] = []): boolean {
  try {
    const parsed = new URL(url || '');
    const target = normalizeTargetDomain(domain);
    if (!target || parsed.hostname.toLowerCase() !== target) return false;
    if (!LOGIN_ROUTE_PATTERN.test(parsed.pathname)) return false;
    return !hasOAuthCallbackCredential(url, extraParams);
  } catch {
    return false;
  }
}

export function getLoginCandidateUrls(domain: string): string[] {
  return ['/login', '/sign-in', '/signin'].map((p) => `https://${domain}${p}`);
}

export function isInvalidTabUrl(url: string | undefined): boolean {
  return !url || String(url).startsWith('chrome-error://');
}

export function isInvalidHttpStatus(status: number): boolean {
  return status === 404 || status === 410;
}

/** 解析用户输入（域名或完整 URL），返回 { domain, pageUrl } 或 null */
export function parseSiteInput(input: string): { domain: string; pageUrl?: string } | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const hasScheme = /^https?:\/\//i.test(raw);
  const candidate = hasScheme ? raw : raw.includes('/') ? `https://${raw}` : null;

  if (candidate) {
    try {
      const url = new URL(candidate);
      if (!url.hostname || !url.hostname.includes('.')) return null;
      return { domain: url.hostname.toLowerCase(), pageUrl: url.href };
    } catch {
      return null;
    }
  }

  const domain = raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!domain || !domain.includes('.')) return null;
  return { domain };
}

const INVALID_SITE_ERROR_CODE = 'INVALID_SITE';

export function createInvalidSiteError(url?: string): Error & { code: string; url?: string } {
  const error = new Error('站点页面失效') as Error & { code: string; url?: string };
  error.code = INVALID_SITE_ERROR_CODE;
  if (url) error.url = url;
  return error;
}

export function isInvalidSiteError(error: unknown): boolean {
  return (error as { code?: string })?.code === INVALID_SITE_ERROR_CODE;
}
