/**
 * 页面注入函数：在站点登录页勾选「同意协议」并点击「Linux.do 登录」入口。自包含。
 * 移植自 reference/background.js clickSiteLinuxDoLoginButton。
 */
export interface LoginAgreementConfig {
  agreementPatternSource: string;
  negativePatternSource: string;
  humanVerificationTextPatternSource: string;
  controlSelectors: string[];
  skipSelectors: string[];
}

export interface ClickLoginResult {
  clicked: boolean;
  text: string;
  agreementSelected: number;
}

export interface ClickLoginConfig {
  agreement: LoginAgreementConfig | null;
  /** 登录按钮匹配正则源（按 OAuth 提供方不同：linux.do / github …） */
  loginPatternSource: string;
}

export function clickSiteOAuthLogin(config: ClickLoginConfig): ClickLoginResult {
  const loginPattern = new RegExp(config.loginPatternSource, 'i');
  const selectors = [
    'a[href]',
    'button',
    '[role="button"]',
    'input[type="button"]',
    'input[type="submit"]',
    '[onclick]',
    '[class*="cursor-pointer"]',
  ];

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  /**
   * 关闭会遮挡登录入口的「公告 / 通知」类弹窗（Semi / AntD），避免点击被遮罩拦截。
   * 仅针对公告/通知：跳过人机验证弹窗、以及含登录/授权文案的弹窗（不误关登录框）。
   */
  function dismissBlockingNoticeModals(): number {
    const NOTICE = /系统公告|公告|通知|announcement|notice/i;
    const SECURITY =
      /captcha|turnstile|人机验证|安全验证|验证码|hCaptcha|reCAPTCHA|Cloudflare|请完成验证/i;
    const loginPattern = new RegExp(config.loginPatternSource, 'i');
    const modals = Array.from(
      document.querySelectorAll(
        '.semi-modal-content, .ant-modal, [role="dialog"][aria-modal="true"]',
      ),
    ).filter((m) => isVisible(m));
    let closed = 0;
    for (const modal of modals) {
      const text = String(modal.textContent || '').replace(/\s+/g, ' ').trim();
      if (SECURITY.test(text) || loginPattern.test(text)) continue;
      const footerButtons = Array.from(modal.querySelectorAll('button'));
      const hasNoticeFooter = footerButtons.some((b) =>
        /^(关闭公告|今日关闭|关闭通知)$/.test(String(b.textContent || '').trim()),
      );
      if (!NOTICE.test(text) && !hasNoticeFooter) continue;
      const closeBtn =
        modal.querySelector(
          '.semi-modal-close, .ant-modal-close, [aria-label="close" i], [aria-label="关闭"]',
        ) ||
        footerButtons.find((b) =>
          /^(关闭公告|今日关闭|关闭通知|关闭|Close)$/i.test(String(b.textContent || '').trim()),
        );
      if (closeBtn) {
        try {
          (closeBtn as HTMLElement).click();
          closed++;
        } catch {
          /* ignore */
        }
      }
    }
    return closed;
  }

  function collectText(el: Element): string {
    const attrs = Array.from(el.attributes || []).map((a) => `${a.name}=${a.value}`);
    const childAttrs = Array.from(el.querySelectorAll('*')).flatMap((child) =>
      Array.from(child.attributes || []).map((a) => `${a.name}=${a.value}`),
    );
    return [
      el.textContent,
      (el as HTMLInputElement).value,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('href'),
      ...attrs,
      ...childAttrs,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isInsideSkippedArea(el: Element, skip: string[]): boolean {
    for (const s of skip || []) {
      try {
        if (el.closest(s)) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  function isLoginAgreementText(text: string, config: LoginAgreementConfig): boolean {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 260) return false;
    if (new RegExp(config.humanVerificationTextPatternSource, 'i').test(normalized)) return false;
    if (new RegExp(config.negativePatternSource, 'i').test(normalized)) return false;
    return new RegExp(config.agreementPatternSource, 'i').test(normalized);
  }

  function getCheckboxLabel(cb: Element): Element | null {
    const wrapping = cb.closest('label');
    if (wrapping) return wrapping;
    const labelledBy = cb.getAttribute('aria-labelledby');
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .find(Boolean);
      if (label) return label;
    }
    const id = cb.getAttribute('id');
    if (id) {
      const label = Array.from(document.querySelectorAll('label[for]')).find(
        (c) => c.getAttribute('for') === id,
      );
      if (label) return label;
    }
    return cb.parentElement;
  }

  function collectAgreementText(cb: Element): string {
    const nearby = [
      getCheckboxLabel(cb),
      cb.parentElement,
      cb.previousElementSibling,
      cb.nextElementSibling,
    ].filter(Boolean) as Element[];
    return nearby.map(collectText).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isChecked(control: Element): boolean {
    if ((control as HTMLInputElement).matches?.('input[type="checkbox"]'))
      return Boolean((control as HTMLInputElement).checked);
    return (
      control.getAttribute('aria-checked') === 'true' ||
      control.getAttribute('data-state') === 'checked' ||
      control.hasAttribute('data-checked')
    );
  }

  function isControlDisabled(control: Element): boolean {
    return (
      Boolean((control as HTMLInputElement).disabled) ||
      control.getAttribute('aria-disabled') === 'true' ||
      control.hasAttribute('data-disabled') ||
      Boolean(control.closest('[disabled], [aria-disabled="true"], [data-disabled]'))
    );
  }

  function selectAgreementCheckboxes(config: LoginAgreementConfig | null): number {
    if (!config) return 0;
    const controls = Array.from(
      new Set(Array.from(document.querySelectorAll(config.controlSelectors.join(',')))),
    );
    let selected = 0;
    for (const cb of controls) {
      if (isChecked(cb) || isControlDisabled(cb) || !isVisible(cb)) continue;
      if (isInsideSkippedArea(cb, config.skipSelectors)) continue;
      if (isLoginAgreementText(collectAgreementText(cb), config)) {
        (cb as HTMLElement).click();
        selected++;
      }
    }
    return selected;
  }

  // 先关掉遮挡登录入口的公告/通知弹窗，再勾选协议并查找登录按钮
  dismissBlockingNoticeModals();
  const agreementSelected = selectAgreementCheckboxes(config.agreement);
  const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    if (
      (el as HTMLButtonElement).disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.closest('[disabled], [aria-disabled="true"]')
    )
      continue;
    const text = collectText(el);
    if (loginPattern.test(text)) {
      (el as HTMLElement).click();
      return { clicked: true, text: text.slice(0, 100), agreementSelected };
    }
  }
  return { clicked: false, text: 'no linux.do login entry found', agreementSelected };
}
