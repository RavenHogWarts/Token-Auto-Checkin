/**
 * OAuth 登录策略（provider 无关）。整合 NewAPI / Sub2API / ZenAPI 三套入口 + 站点登录页通用入口。
 * 「重新登录」的第三方提供方可为 linux.do 或 github（见 auth.oauthProvider）。
 * 移植自 reference/background.js 的 autoOAuthLogin / autoSub2ApiOAuthLogin / autoZenApiOAuthLogin。
 */
import { browser } from '#imports';
import type { AuthContext, RunContext } from '../../core/context';
import { closeTabUnlessInSession } from '../../core/tab-session';
import { getLoginAgreementProbeConfig } from '../../domain/login-agreement';
import { getProviderSpec, type OAuthProviderSpec } from '../../domain/oauth-providers';
import {
  buildNewApiLinuxDoOAuthUrl,
  buildSub2ApiLinuxDoOAuthStartUrl,
  buildZenApiLoginUrl,
  extractZenApiLinuxDoToken,
  getNewApiPostLoginUrl,
  getSub2ApiPostLoginUrl,
  isSub2ApiTargetLoginPage,
  isZenApiTargetLoginPage,
} from '../../domain/oauth-urls';
import type { SiteProfile } from '../../domain/site-profile';
import { clickAuthorizeButton } from '../../page/click-authorize';
import { clickSiteOAuthLogin } from '../../page/click-login';
import { hasUserSession, inspectBrowserSession } from '../../page/read-login-state';
import { readTokenFromStorage } from '../../page/read-token';
import { probeTab } from '../../services/human-verification';
import {
  ensureTabPageReady,
  getTab,
  runInTab,
  waitForTabUrlMatch,
  waitForUsableTabPage,
} from '../../services/tabs';
import { mergeAuthorizationHeader } from '../../shared/auth-headers';
import { sleep } from '../../shared/time';
import { getLoginCandidateUrls, isInvalidSiteError, isTargetSiteLoginPage } from '../../shared/url';
import { readSessionHeaders } from './session-headers';

/** 预检该 OAuth 提供方是否已登录（有 cookie） */
async function hasProviderCookies(spec: OAuthProviderSpec): Promise<boolean> {
  const cookies = await browser.cookies.getAll({ domain: spec.cookieDomain });
  return cookies.length > 0;
}

function urlHitsAuthorizeHost(url: string, spec: OAuthProviderSpec): boolean {
  return spec.authorizeHosts.some((h) => url.includes(h));
}

/** 在标签页内 fetch JSON 并返回解析结果 */
function fetchJsonInTab(url: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return fetch(url, { credentials: 'include' })
    .then(async (r) => ({ ok: true, data: await r.json() }))
    .catch((e: Error) => ({ ok: false, error: e.message }));
}

/** 在授权页点击「允许」并等待回跳目标域名 */
async function clickAuthorizeAndWaitRedirect(
  tabId: number,
  domain: string,
  postLoginUrl: string,
): Promise<boolean> {
  await runInTab(tabId, clickAuthorizeButton, []);
  const redirected = await waitForTabUrlMatch(tabId, domain, 30000);
  if (!redirected) return false;
  await ensureTabPageReady(tabId, postLoginUrl, 20000);
  await sleep(1000);
  return true;
}

interface LoginPageResult {
  ok: boolean;
  securityCheck?: boolean;
  tabId: number;
}

/**
 * 站点登录页通用 OAuth 入口：切换 /login|/sign-in|/signin，勾选协议，点对应提供方登录按钮，
 * 处理第三方授权页并等待回跳。provider 无关。
 */
async function siteLoginPageOAuth(
  tabId: number,
  domain: string,
  postLoginUrl: string,
  spec: OAuthProviderSpec,
): Promise<LoginPageResult> {
  const candidates = getLoginCandidateUrls(domain);
  const startedAt = Date.now();
  let candidateIndex = 0;
  let lastUrl = '';

  while (Date.now() - startedAt < 25000) {
    const tab = await getTab(tabId);
    if (!tab) return { ok: false, tabId };
    lastUrl = tab.url || lastUrl;

    if (await probeTab(tabId)) return { ok: false, securityCheck: true, tabId };

    if (urlHitsAuthorizeHost(lastUrl, spec)) {
      const ok = await clickAuthorizeAndWaitRedirect(tabId, domain, postLoginUrl);
      return { ok, tabId };
    }

    if (lastUrl.includes(domain) && !isTargetSiteLoginPage(lastUrl, domain)) {
      return { ok: true, tabId };
    }

    if (!isTargetSiteLoginPage(lastUrl, domain)) {
      const target = candidates[candidateIndex % candidates.length]!;
      candidateIndex++;
      await browser.tabs.update(tabId, { url: target, active: false });
      await ensureTabPageReady(tabId, target, 20000).catch(() => {});
      await sleep(1000);
      continue;
    }

    const clicked = await runInTab(tabId, clickSiteOAuthLogin, [
      { agreement: getLoginAgreementProbeConfig(), loginPatternSource: spec.loginButtonPatternSource },
    ]);
    if (!clicked?.clicked) {
      await sleep(800);
      continue;
    }
    await sleep(1500);
    await waitForUsableTabPage(tabId, 20000);
  }
  return { ok: false, tabId };
}

async function processNewApiCallback(tabId: number, providerId: string): Promise<void> {
  const tab = await getTab(tabId);
  let code: string | null = null;
  try {
    code = new URL(tab?.url || '').searchParams.get('code');
  } catch {
    return;
  }
  if (!code) return;
  await runInTab(tabId, fetchJsonInTab, [`/api/oauth/${providerId}?code=${code}`]);
  await sleep(1000);
}

async function newApiOAuth(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<AuthContext | null> {
  const { domain } = profile;
  const visitUrl = profile.checkin.pageUrl;
  const postLoginUrl = getNewApiPostLoginUrl(domain, visitUrl);
  const spec = getProviderSpec(profile.auth.oauthProvider);
  const log = ctx.logger;

  if (!(await hasProviderCookies(spec))) {
    log.warn(`${spec.label} 未登录，无法 OAuth`);
    return null;
  }

  const tab = await ctx.tabSession.open(`https://${domain}/`);
  const tabId = tab.id!;

  // linux.do 有直连 client_id 快捷路径；其它提供方走站点登录页入口
  if (spec.id === 'linuxdo') {
    const statusRes = await runInTab(tabId, fetchJsonInTab, ['/api/status']);
    const statusData = statusRes?.data as { data?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    const clientId =
      (statusData?.data?.linuxdo_client_id as string) || (statusData?.linuxdo_client_id as string);

    if (clientId) {
      const stateRes = await runInTab(tabId, fetchJsonInTab, ['/api/oauth/state']);
      const stateData = stateRes?.data as { success?: boolean; data?: string };
      if (!stateData?.success || !stateData?.data) {
        log.warn('获取 OAuth state 失败');
        return null;
      }
      await browser.tabs.update(tabId, {
        url: buildNewApiLinuxDoOAuthUrl(clientId, stateData.data),
      });
      await ensureTabPageReady(tabId, postLoginUrl, 20000).catch(() => {});
      await sleep(1000);

      const cur = await getTab(tabId);
      if (cur?.url && urlHitsAuthorizeHost(cur.url, spec)) {
        if (await probeTab(tabId)) return { securityCheck: true, tabId };
        if (!(await clickAuthorizeAndWaitRedirect(tabId, domain, postLoginUrl))) return null;
      }
      return finalizeNewApiLogin(domain, postLoginUrl, tabId, spec.id);
    }
    log.warn('无 linuxdo_client_id，改用站点登录页入口');
  }

  const loginResult = await siteLoginPageOAuth(tabId, domain, postLoginUrl, spec);
  if (loginResult.securityCheck) return { securityCheck: true, tabId };
  if (!loginResult.ok) return null;
  return finalizeNewApiLogin(domain, postLoginUrl, tabId, spec.id);
}

async function finalizeNewApiLogin(
  domain: string,
  postLoginUrl: string,
  tabId: number,
  providerId: string,
): Promise<AuthContext | null> {
  await processNewApiCallback(tabId, providerId);

  let ok = false;
  for (let i = 0; i < 5; i++) {
    await sleep(1500);
    const session = await runInTab(tabId, inspectBrowserSession, []);
    if (session?.success && hasUserSession(session)) {
      ok = true;
      break;
    }
  }
  if (!ok) return null;

  await browser.tabs.update(tabId, { url: postLoginUrl, active: false });
  await ensureTabPageReady(tabId, postLoginUrl, 20000).catch(() => {});
  await sleep(1000);

  const headers = await readSessionHeaders(domain, tabId);
  if (!headers) return null;
  return { headers, tabId };
}

async function sub2ApiOAuth(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<AuthContext | null> {
  const { domain } = profile;
  const visitUrl = profile.checkin.pageUrl;
  const postLoginUrl = getSub2ApiPostLoginUrl(domain, visitUrl);
  const spec = getProviderSpec(profile.auth.oauthProvider);
  const tokenKeys = profile.auth.tokenKeys ?? ['auth_token', 'access_token', 'token'];
  if (!(await hasProviderCookies(spec))) {
    ctx.logger.warn(`${spec.label} 未登录，无法 Sub2API OAuth`);
    return null;
  }

  // linux.do 有 /oauth/linuxdo/start 快捷入口；其它提供方从登录页走通用流程
  const startUrl = spec.id === 'linuxdo' ? buildSub2ApiLinuxDoOAuthStartUrl(domain, visitUrl) : visitUrl;
  const tab = await ctx.tabSession.open(startUrl);
  const tabId = tab.id!;
  let cur = await getTab(tabId);

  if (spec.id !== 'linuxdo' || (cur && isSub2ApiTargetLoginPage(cur.url || '', domain))) {
    const loginResult = await siteLoginPageOAuth(tabId, domain, postLoginUrl, spec);
    if (loginResult.securityCheck) return { securityCheck: true, tabId };
    if (!loginResult.ok) return null;
  } else if (cur?.url && urlHitsAuthorizeHost(cur.url, spec)) {
    if (await probeTab(tabId)) return { securityCheck: true, tabId };
    if (!(await clickAuthorizeAndWaitRedirect(tabId, domain, postLoginUrl))) return null;
  }

  for (let i = 0; i < 10; i++) {
    const token = await runInTab(tabId, readTokenFromStorage, [tokenKeys]);
    if (token) return { headers: mergeAuthorizationHeader({}, token), tabId };
    await sleep(1000);
  }

  // 读不到 token：改用当前标签页 session（cookie）
  cur = await getTab(tabId);
  if (cur?.url?.includes(domain) && !isSub2ApiTargetLoginPage(cur.url || '', domain)) {
    return { tabId, cookieOnly: true };
  }
  return null;
}

/** 页面注入函数：写入 ZenAPI user_token 并清理回调参数。自包含。 */
function writeZenApiToken(token: string): void {
  localStorage.setItem('user_token', token);
  history.replaceState(null, '', '/user');
}

async function zenApiOAuth(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<AuthContext | null> {
  const { domain } = profile;
  const postLoginUrl = `https://${domain}/user`;
  const spec = getProviderSpec(profile.auth.oauthProvider);
  const tokenKeys = profile.auth.tokenKeys ?? ['user_token'];
  if (!(await hasProviderCookies(spec))) {
    ctx.logger.warn(`${spec.label} 未登录，无法 ZenAPI OAuth`);
    return null;
  }

  const startUrl = spec.id === 'linuxdo' ? buildZenApiLoginUrl(domain) : postLoginUrl;
  const tab = await ctx.tabSession.open(startUrl);
  const tabId = tab.id!;
  let cur = await getTab(tabId);

  if (spec.id !== 'linuxdo' || (cur && isZenApiTargetLoginPage(cur.url || '', domain))) {
    const loginResult = await siteLoginPageOAuth(tabId, domain, postLoginUrl, spec);
    if (loginResult.securityCheck) return { securityCheck: true, tabId };
    if (!loginResult.ok) return null;
  } else if (cur?.url && urlHitsAuthorizeHost(cur.url, spec)) {
    if (await probeTab(tabId)) return { securityCheck: true, tabId };
    if (!(await clickAuthorizeAndWaitRedirect(tabId, domain, postLoginUrl))) return null;
  }

  cur = await getTab(tabId);
  const callbackToken = extractZenApiLinuxDoToken(cur?.url || '');
  if (callbackToken) await runInTab(tabId, writeZenApiToken, [callbackToken]);
  await sleep(1000);

  const token = (await runInTab(tabId, readTokenFromStorage, [tokenKeys])) || callbackToken;
  if (!token) return null;
  return { headers: mergeAuthorizationHeader({}, token), tabId, needsTabExecution: true };
}

/** OAuth 策略主入口：按 preset 分派 */
export async function resolveOAuthAuth(
  profile: SiteProfile,
  ctx: RunContext,
): Promise<AuthContext | null> {
  try {
    switch (profile.preset) {
      case 'sub2api':
        return await sub2ApiOAuth(profile, ctx);
      case 'zenapi':
        return await zenApiOAuth(profile, ctx);
      default:
        return await newApiOAuth(profile, ctx);
    }
  } catch (e) {
    if (isInvalidSiteError(e)) throw e;
    ctx.logger.warn('OAuth 失败:', e);
    await closeTabUnlessInSession(undefined, ctx.tabSession);
    return null;
  }
}
