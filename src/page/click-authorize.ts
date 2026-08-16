/**
 * 页面注入函数：在 linux.do 授权页点击「允许 / 授权」。自包含。
 * 移植自 reference/background.js clickLinuxDoAuthorizeButton。
 */
export function clickAuthorizeButton(): string {
  const selectors = ['button', 'input[type="submit"]', 'a[class*="btn"]', '[role="button"]'];
  const candidates = document.querySelectorAll<HTMLElement>(selectors.join(','));
  for (const el of Array.from(candidates)) {
    const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
    if (/allow|允许|授权|approve|accept|Authorize|同意/i.test(text)) {
      el.click();
      return `clicked: ${text}`;
    }
  }

  const links = document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="approve"], a[href*="authorize"]',
  );
  for (const link of Array.from(links)) {
    link.click();
    return `clicked approve link: ${link.href}`;
  }

  const form = document.querySelector('form');
  const submit = form?.querySelector<HTMLElement>('[type="submit"], button');
  if (submit) {
    submit.click();
    return 'clicked form submit';
  }
  return 'no authorize button found';
}
