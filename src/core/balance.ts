/** 余额解析编排：响应 → 接口 → 页面。见 dev/04-架构设计.md 4.1 BalanceStep。 */
import type { ParsedCheckinResponse } from '../domain/checkin-result';
import {
  extractBalanceFromData,
  extractBalanceFromText,
  extractSub2ApiBalanceFromTexts,
} from '../domain/balance';
import type { SiteProfile } from '../domain/site-profile';
import { readPageContent } from '../page/read-page-content';
import { doFetchWithHeaders } from '../services/checkin-request';
import { runInTab } from '../services/tabs';
import type { AuthContext } from './context';

function getBalanceQueryUrls(profile: SiteProfile): string[] {
  const domain = profile.domain;
  const urls = [
    ...(profile.balance?.queryUrls ?? []),
    profile.checkin.api?.queryUrl,
    `https://${domain}/api/user/self`,
    `https://${domain}/api/status`,
    `https://${domain}/api/u/dashboard`,
    `https://${domain}/api/v1/user/info`,
    `https://${domain}/api/v1/user`,
  ].filter((u): u is string => Boolean(u));
  return [...new Set(urls)];
}

function extractFromResponse(execResult: ParsedCheckinResponse | null): string | null {
  if (!execResult) return null;
  return extractBalanceFromData(execResult.data);
}

async function readBalanceFromTab(tabId: number, profile: SiteProfile): Promise<string | null> {
  try {
    const page = await runInTab(tabId, readPageContent, [profile.preset === 'sub2api']);
    if (!page) return null;
    if (profile.preset === 'sub2api') {
      const fromSub2 = extractSub2ApiBalanceFromTexts(page.sub2ApiBalanceTexts || []);
      if (fromSub2) return fromSub2;
    }
    return extractBalanceFromText(page.bodyText || '');
  } catch {
    return null;
  }
}

export async function resolveBalance(
  profile: SiteProfile,
  auth: AuthContext,
  execResult: ParsedCheckinResponse | null,
  tabId?: number,
): Promise<string | null> {
  const fromResponse = extractFromResponse(execResult);
  if (fromResponse) return fromResponse;

  if (auth.headers && !auth.cookieOnly) {
    for (const url of getBalanceQueryUrls(profile)) {
      try {
        const res = await doFetchWithHeaders(url, 'GET', undefined, auth.headers);
        const fromData = extractBalanceFromData(res.data);
        if (fromData) return fromData;
      } catch {
        /* try next */
      }
    }
  }

  if (tabId) {
    const fromPage = await readBalanceFromTab(tabId, profile);
    if (fromPage) return fromPage;
  }
  return null;
}
