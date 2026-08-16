/**
 * 页面注入函数：读取页面内容用于余额提取与页面状态判断。自包含。
 */
export interface PageContentSnapshot {
  url: string;
  title: string;
  readyState: string;
  bodyText: string;
  sub2ApiBalanceTexts: string[];
}

export function readPageContent(isSub2Api: boolean): PageContentSnapshot {
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyText: document.body?.innerText || '',
    sub2ApiBalanceTexts: isSub2Api
      ? Array.from(document.querySelectorAll('.text-sm.font-semibold')).map(
          (el) => el.textContent || '',
        )
      : [],
  };
}

/** 页面注入函数：读取站点显示名（标题 / meta） */
export function readSiteNameMeta(): {
  title: string;
  ogSiteName: string;
  applicationName: string;
  siteName: string;
} {
  const meta = (selector: string) =>
    document.querySelector<HTMLMetaElement>(selector)?.content || '';
  return {
    title: document.title,
    ogSiteName: meta('meta[property="og:site_name"]'),
    applicationName: meta('meta[name="application-name"]'),
    siteName: meta('meta[name="site-name"]'),
  };
}
