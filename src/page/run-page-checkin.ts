/**
 * 页面注入函数：在官方页面查找并点击签到按钮，捕获签到接口响应。自包含。
 * 移植并扩展自 reference/background.js checkInFromOfficialPage 注入脚本。
 * 扩展点（场景 C）：options.selectors 用户自定义选择器优先于内置文案匹配。
 */
export interface PageCheckinOptions {
  targetUrl: string;
  /** 有序点击步骤（先当选择器再当文案）；存在时优先使用 */
  steps?: string[];
  /** 每步点击之间的等待毫秒，默认 1500 */
  stepDelayMs?: number;
  selectors?: string[];
  textPatterns?: string[];
  /** 到达签到位置前依次点击的导航目标（先当选择器，再当文案） */
  navSteps?: string[];
  /** 每步等待毫秒，默认 1500 */
  navStepDelayMs?: number;
  humanVerification: { textPatternSource: string; selectors: string[] };
  cleanupOrdinaryDialogs?: boolean;
  skipOrdinaryDialogCleanup?: boolean;
  regularWaitLoops?: number;
  pollIntervalMs?: number;
}

export interface PageCheckinResult {
  kind: 'response' | 'already' | 'success' | 'no-button' | 'security-check' | 'timeout';
  message?: string;
  clickedText?: string;
  candidates?: string;
  httpStatus?: number;
  data?: unknown;
  text?: string;
  method?: string;
  url?: string;
}

export async function runPageCheckin(
  options: PageCheckinOptions,
): Promise<PageCheckinResult> {
  const originalFetch = window.fetch;
  const originalXhrOpen = window.XMLHttpRequest?.prototype?.open;
  const originalXhrSend = window.XMLHttpRequest?.prototype?.send;
  const checkInResponses: PageCheckinResult[] = [];
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const regularWaitLoops = options.regularWaitLoops ?? 40;
  const userSelectors = Array.isArray(options.selectors) ? options.selectors : [];
  const extraTextPatterns = Array.isArray(options.textPatterns) ? options.textPatterns : [];
  const navSteps = Array.isArray(options.navSteps) ? options.navSteps : [];
  const navStepDelayMs = options.navStepDelayMs ?? 1500;
  const steps = Array.isArray(options.steps) ? options.steps.filter(Boolean) : [];
  const stepDelayMs = options.stepDelayMs ?? 1500;
  let securityCheckNotified = false;
  let targetPath = '';
  try {
    targetPath = new URL(options.targetUrl).pathname;
  } catch {
    /* ignore */
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  function recordCheckInResponse(
    url: string,
    method: string,
    status: number,
    text: string,
  ): void {
    try {
      if (!url) return;
      const requestMethod = String(method || 'GET').toUpperCase();
      const requestPath = new URL(String(url), location.origin).pathname;
      const commonCheckInPath =
        requestPath.includes('/checkin') ||
        requestPath.includes('/check-in') ||
        requestPath.includes('/signin') ||
        requestPath.includes('/sign-in');
      if (requestPath !== targetPath && !commonCheckInPath) return;
      if (requestMethod !== 'POST' && !commonCheckInPath) return;
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* not json */
      }
      checkInResponses.push({
        kind: 'response',
        httpStatus: status,
        data,
        text,
        method: requestMethod,
        url: String(url),
      });
    } catch {
      /* ignore */
    }
  }

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch.apply(window, args);
    try {
      const request = args[0];
      const init = args[1] || {};
      const url =
        typeof request === 'string' ? request : (request as Request)?.url;
      const method = String(
        init.method || (request as Request)?.method || 'GET',
      ).toUpperCase();
      if (url) {
        const text = await response.clone().text();
        recordCheckInResponse(url, method, response.status, text);
      }
    } catch {
      /* ignore */
    }
    return response;
  };

  if (originalXhrOpen && originalXhrSend) {
    window.XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __req?: { method: string; url: string } },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__req = { method, url: String(url || '') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalXhrOpen as any).call(this, method, url, ...rest);
    };
    window.XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __req?: { method: string; url: string } },
      ...args: unknown[]
    ) {
      try {
        this.addEventListener(
          'load',
          () => {
            const req = this.__req || { method: 'GET', url: '' };
            recordCheckInResponse(req.url, req.method, this.status, this.responseText || '');
          },
          { once: true },
        );
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalXhrSend as any).apply(this, args);
    };
  }

  function getCandidateText(el: Element): string {
    return [
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-title'),
      el.getAttribute('data-tooltip'),
      (el as HTMLInputElement).value,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function notifySecurityCheckDetected(): void {
    if (securityCheckNotified) return;
    securityCheckNotified = true;
    try {
      const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome
        ?.runtime as { sendMessage?: (m: unknown, cb?: () => void) => void } | undefined;
      runtime?.sendMessage?.({ type: 'event/human-verification-detected' }, () => void 0);
    } catch {
      /* ignore */
    }
  }

  function hasSecurityCheck(): boolean {
    const text = document.body?.innerText || '';
    const opts = options.humanVerification || { textPatternSource: '', selectors: [] };
    const textPattern = new RegExp(opts.textPatternSource || 'captcha', 'i');
    const selectorMatch = (opts.selectors || []).some((s) => {
      try {
        return Boolean(document.querySelector(s));
      } catch {
        return false;
      }
    });
    const detected = textPattern.test(text) || selectorMatch;
    if (detected) notifySecurityCheckDetected();
    return detected;
  }

  function isOrdinaryDialogCloseControl(text: string): boolean {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 40) return false;
    if (
      /Security Check|安全验证|人机验证|Turnstile|captcha|验证码|请完成验证|verify you are human|hCaptcha|reCAPTCHA|Cloudflare/i.test(
        normalized,
      )
    )
      return false;
    if (/linux\s*\.?\s*do|oauth|authorize|授权|允许|登录|login|verify|验证/i.test(normalized))
      return false;
    return /^(×|x|X|关闭|关闭公告|关闭通知|今日关闭|知道了|我知道了|好的|确定|取消|OK|Ok|ok|Close|Dismiss|Got it)$/i.test(
      normalized,
    );
  }

  async function closeOrdinaryDialogs(): Promise<void> {
    if (options.cleanupOrdinaryDialogs !== true || options.skipOrdinaryDialogCleanup === true)
      return;
    if (hasSecurityCheck()) return;
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch {
      /* ignore */
    }
    await wait(100);

    // 1) 显式点常见 UI 库弹窗的关闭 X（Semi / AntD 等）：文案抽取不可靠时更稳，
    //    如 agentrouter「系统公告」弹窗的 button.semi-modal-close[aria-label="close"]。
    const explicitCloseSelectors = [
      '.semi-modal-close',
      '.ant-modal-close',
      '[role="dialog"] [aria-label="close" i]',
      '[role="dialog"] [aria-label="关闭"]',
    ];
    const explicitClose = Array.from(document.querySelectorAll(explicitCloseSelectors.join(', ')))
      .filter((el) => isVisible(el))
      .filter((el) => !el.closest('.cf-turnstile, .g-recaptcha, .h-captcha, [data-sitekey]'))
      .slice(0, 3);
    for (const el of explicitClose) {
      try {
        (el as HTMLElement).click();
        await wait(150);
      } catch {
        /* ignore */
      }
    }

    // 2) 文案匹配兜底（× / 关闭 / 关闭公告 / 今日关闭 / Close / Dismiss …）
    const selector = [
      'button',
      '[role="button"]',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[aria-label]',
      '[title]',
      '[data-dismiss]',
      '[class*="close"]',
      '[class*="modal-close"]',
    ].join(', ');
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((el) => isVisible(el))
      .filter((el) => !el.closest('.cf-turnstile, .g-recaptcha, .h-captcha, [data-sitekey]'))
      .filter((el) => isOrdinaryDialogCloseControl(getCandidateText(el)))
      .slice(0, 3);
    for (const el of candidates) {
      try {
        (el as HTMLElement).click();
        await wait(150);
      } catch {
        /* ignore */
      }
    }
  }

  function matchesAlreadyCheckedText(text: string): boolean {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 40) return false;
    return (
      /^(Checked in|Already checked|Already signed|已签到|已签|已签过|今日已签|今日已签到|今天已签|今天已签到|已经签到)$/i.test(
        normalized,
      ) ||
      /^(今日|今天).{0,12}(已签到|已签|已签过|已经签到)$/i.test(normalized) ||
      /^(Checked in|Already checked|Already signed).{0,16}today$/i.test(normalized)
    );
  }

  function findCheckedInStateText(): string {
    const els = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [role="status"], [aria-live], a, input[type="button"], input[type="submit"], [tabindex]:not([tabindex="-1"]), [onclick], [class*="cursor-pointer"], [data-slot="button"], [class*="status"], [class*="tag"], [class*="badge"], [class*="checked"], [class*="signed"], [class*="success"], span, p',
      ),
    );
    const found = els.find((el) => {
      const text = getCandidateText(el).replace(/\s+/g, ' ').trim();
      return text && isVisible(el) && matchesAlreadyCheckedText(text);
    });
    return found ? getCandidateText(found).replace(/\s+/g, ' ').trim() : '';
  }

  function isDisabledCandidate(el: Element): boolean {
    return (
      (el as HTMLButtonElement).disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled') ||
      Boolean(el.closest('[aria-disabled="true"], [disabled]'))
    );
  }

  const builtinCheckInSource =
    'Check in now|check.?in|checkin|daily check.?in|daily reward|claim reward|领取奖励|领取额度|每日领取|签到领取|每日福利|今日福利|立即签到|现在签到|每日签到|^签$|^签到$|^领取$';
  const checkInTextPattern = new RegExp(
    [builtinCheckInSource, ...extraTextPatterns].filter(Boolean).join('|'),
    'i',
  );

  function matchesCheckInText(text: string): boolean {
    return checkInTextPattern.test(text);
  }

  function isNonUserCheckInControl(text: string): boolean {
    return /settings?|配置|设置|enable check.?in|minimum check.?in|maximum check.?in|check.?in quota/i.test(
      text,
    );
  }

  function getCheckInTextPriority(text: string): number {
    if (/立即签到|现在签到|Check in now|^签到$|^签$/i.test(text)) return 0;
    if (/签到领取|领取奖励|领取额度|claim reward|^领取$/i.test(text)) return 1;
    if (/每日签到|每日领取|daily check.?in|daily reward|今日福利|每日福利/i.test(text)) return 2;
    if (/check.?in|checkin/i.test(text)) return 3;
    return 4;
  }

  const clickableSelector = [
    'button',
    '[role="button"]',
    'a',
    'input[type="button"]',
    'input[type="submit"]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[class*="cursor-pointer"]',
    '[data-slot="button"]',
  ].join(', ');

  /** 用户自定义选择器优先（场景 C） */
  function findUserSelectorButton(): HTMLElement | null {
    for (const selector of userSelectors) {
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && isVisible(el) && !isDisabledCandidate(el)) return el;
      } catch {
        /* invalid selector */
      }
    }
    return null;
  }

  function findCheckInButton(immediateOnly = false): HTMLElement | null {
    const direct = Array.from(document.querySelectorAll<HTMLElement>(clickableSelector));
    const textCands = Array.from(
      document.querySelectorAll<HTMLElement>('button, a, div, span, p, li'),
    ).filter((el) => {
      const text = getCandidateText(el);
      return text && text.length <= 80 && matchesCheckInText(text);
    });
    const candidates = [...direct, ...textCands]
      .map((el) => (el.closest<HTMLElement>(clickableSelector) as HTMLElement) || el)
      .filter((el, i, arr) => el && arr.indexOf(el) === i);
    return (
      candidates
        .map((el, index) => ({ el, index, text: getCandidateText(el) }))
        .filter(
          ({ el, text }) =>
            text &&
            text.length <= 120 &&
            !isDisabledCandidate(el) &&
            isVisible(el) &&
            matchesCheckInText(text) &&
            (!immediateOnly || getCheckInTextPriority(text) === 0) &&
            !isNonUserCheckInControl(text) &&
            !matchesAlreadyCheckedText(text),
        )
        .sort(
          (a, b) => getCheckInTextPriority(a.text) - getCheckInTextPriority(b.text) || a.index - b.index,
        )[0]?.el || null
    );
  }

  function getCheckInCandidateSummary(): string {
    return Array.from(document.querySelectorAll(clickableSelector))
      .map(getCandidateText)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((t) => t.length <= 80)
      .slice(0, 8)
      .join(' | ');
  }

  function hasDisabledCheckInButton(): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>(clickableSelector)).some((el) => {
      const text = getCandidateText(el);
      return (
        text &&
        text.length <= 120 &&
        isDisabledCandidate(el) &&
        isVisible(el) &&
        matchesCheckInText(text) &&
        !isNonUserCheckInControl(text) &&
        !matchesAlreadyCheckedText(text) &&
        !/Loading|加载|处理中/i.test(text)
      );
    });
  }

  /**
   * 导航步骤：SPA 无法直接 URL 跳转到签到页时，依次点击目标到达签到位置。
   * 每项先当 CSS 选择器，匹配不到再当可见文案（如「个人资料」）。
   */
  function clickBySelectorOrText(step: string): boolean {
    const target = String(step || '').trim();
    if (!target) return false;
    try {
      const el = document.querySelector<HTMLElement>(target);
      if (el && isVisible(el)) {
        (el.closest<HTMLElement>(clickableSelector) || el).click();
        return true;
      }
    } catch {
      /* 不是合法选择器，按文案匹配 */
    }
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, div, span, p, li, [role="button"], [role="menuitem"], img, [class*="avatar"]',
      ),
    );
    const match = els.find((el) => {
      const text = getCandidateText(el).replace(/\s+/g, ' ').trim();
      return text && text.length <= 40 && (text === target || text.includes(target)) && isVisible(el);
    });
    if (match) {
      (match.closest<HTMLElement>(clickableSelector) || match).click();
      return true;
    }
    return false;
  }

  async function runNavSteps(): Promise<void> {
    for (const step of navSteps) {
      clickBySelectorOrText(step);
      await wait(navStepDelayMs);
    }
  }

  /** 步骤模式：依次点击每一步，最后一步通常触发签到；捕获接口响应或已签文案。 */
  async function runStepsMode(): Promise<PageCheckinResult> {
    await closeOrdinaryDialogs();
    let securityCheckSeen = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      let clicked = false;
      for (let t = 0; t < 24 && !clicked; t++) {
        if (hasSecurityCheck()) {
          securityCheckSeen = true;
          await wait(pollIntervalMs);
          continue;
        }
        clicked = clickBySelectorOrText(step);
        if (!clicked) await wait(pollIntervalMs);
      }
      if (!clicked) {
        return {
          kind: hasSecurityCheck() ? 'security-check' : 'no-button',
          message: hasSecurityCheck()
            ? '站点要求完成人机验证，自动签到已停止'
            : `第 ${i + 1} 步未找到可点击元素：${step}`,
          candidates: getCheckInCandidateSummary(),
        };
      }
      await wait(stepDelayMs);
      if (checkInResponses.length > 0) {
        return { ...checkInResponses[checkInResponses.length - 1]!, clickedText: step };
      }
    }
    // 步骤全部点完，轮询签到结果
    const lastStep = steps[steps.length - 1];
    for (let i = 0; i < regularWaitLoops; i++) {
      await wait(pollIntervalMs);
      if (checkInResponses.length > 0) {
        return { ...checkInResponses[checkInResponses.length - 1]!, clickedText: lastStep };
      }
      if (hasSecurityCheck()) {
        securityCheckSeen = true;
        continue;
      }
      if (findCheckedInStateText()) return { kind: 'success', message: '签到成功', clickedText: lastStep };
    }
    return {
      kind: securityCheckSeen ? 'security-check' : 'timeout',
      message: securityCheckSeen
        ? '站点要求完成人机验证，等待超时，自动签到已停止'
        : '已完成全部点击步骤，但未捕获到签到结果',
      clickedText: lastStep,
    };
  }

  try {
    if (steps.length) {
      return await runStepsMode();
    }
    await runNavSteps();
    await closeOrdinaryDialogs();

    let button: HTMLElement | null = findUserSelectorButton();
    let securityCheckSeen = false;
    if (!button) {
      for (let i = 0; i < regularWaitLoops; i++) {
        button = findCheckInButton(true);
        if (button) break;
        const checkedText = findCheckedInStateText();
        if (checkedText) return { kind: 'already', message: `今日已签到: ${checkedText}` };
        if (hasDisabledCheckInButton()) return { kind: 'already', message: '今日已签到' };
        button = findCheckInButton(false);
        if (button) break;
        if (hasSecurityCheck()) securityCheckSeen = true;
        await wait(pollIntervalMs);
      }
    }

    if (!button) {
      const candidates = getCheckInCandidateSummary();
      return {
        kind: hasSecurityCheck() ? 'security-check' : 'no-button',
        message: hasSecurityCheck()
          ? '站点要求完成人机验证，等待超时，自动签到已停止'
          : candidates
            ? `未找到官方页面签到按钮，页面候选: ${candidates}`
            : '未找到官方页面签到按钮，自动签到失败',
        candidates,
      };
    }

    button.scrollIntoView?.({ block: 'center', inline: 'center' });
    await wait(100);
    const clickedText = getCandidateText(button).replace(/\s+/g, ' ').trim().slice(0, 80);
    button.click();

    for (let i = 0; i < regularWaitLoops; i++) {
      await wait(pollIntervalMs);
      if (checkInResponses.length > 0) {
        return { ...checkInResponses[checkInResponses.length - 1]!, clickedText };
      }
      if (hasSecurityCheck()) {
        securityCheckSeen = true;
        continue;
      }
      if (findCheckedInStateText()) {
        return { kind: 'success', message: '签到成功', clickedText };
      }
    }

    return {
      kind: securityCheckSeen ? 'security-check' : 'timeout',
      message: securityCheckSeen
        ? '站点要求完成人机验证，等待超时，自动签到已停止'
        : clickedText
          ? `官方页面已点击「${clickedText}」，但未捕获到签到结果`
          : '官方页面签到请求超时，自动签到失败',
      clickedText,
      candidates: getCheckInCandidateSummary(),
    };
  } finally {
    window.fetch = originalFetch;
    if (originalXhrOpen && originalXhrSend) {
      window.XMLHttpRequest.prototype.open = originalXhrOpen;
      window.XMLHttpRequest.prototype.send = originalXhrSend;
    }
  }
}
