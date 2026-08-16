(function(root) {
  const HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE = [
    'Security Check',
    '安全验证',
    '人机验证',
    'Turnstile',
    'captcha',
    '验证码',
    '请完成验证',
    'verify you are human',
    'hCaptcha',
    'reCAPTCHA',
    'Cloudflare'
  ].join('|');

  const HUMAN_VERIFICATION_SELECTORS = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="google.com/recaptcha"]',
    'iframe[src*="recaptcha.net/recaptcha"]',
    'iframe[src*="hcaptcha.com"]',
    '.cf-turnstile',
    '.g-recaptcha',
    '.h-captcha',
    '[data-sitekey]',
    'input[name="cf-turnstile-response"]',
    'textarea[name="g-recaptcha-response"]',
    'textarea[name="h-captcha-response"]'
  ];

  const HUMAN_VERIFICATION_FOCUS_THROTTLE_MS = 5000;
  const OAUTH_CALLBACK_CREDENTIAL_PARAMS = [
    'code',
    'token',
    'access_token',
    'auth_token',
    'id_token',
    'linuxdo_token',
    'user_token'
  ];
  const LOGIN_ROUTE_PATTERN = /^\/(?:login|sign-in|signin)(?:\/|$)/i;
  const LOGIN_AGREEMENT_PATTERN_SOURCE = [
    '同意',
    '已阅读',
    '我已阅读',
    '协议',
    '用户协议',
    '服务条款',
    '使用条款',
    '隐私',
    '隐私政策',
    '政策',
    '勾选即代表',
    'accept',
    'agree',
    'agreement',
    'terms',
    'terms of service',
    'privacy',
    'privacy policy',
    'policy'
  ].join('|');
  const LOGIN_AGREEMENT_NEGATIVE_PATTERN_SOURCE = [
    '记住',
    '保持登录',
    '自动登录',
    '订阅',
    '邮件',
    '通知',
    '营销',
    'remember',
    'keep me logged',
    'stay signed',
    'auto.?login',
    'newsletter',
    'subscribe',
    'marketing',
    'updates'
  ].join('|');
  const LOGIN_AGREEMENT_SKIP_SELECTORS = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="google.com/recaptcha"]',
    'iframe[src*="recaptcha.net/recaptcha"]',
    'iframe[src*="hcaptcha.com"]',
    '.cf-turnstile',
    '.g-recaptcha',
    '.h-captcha',
    '[data-sitekey]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[class*="turnstile" i]',
    '[id*="turnstile" i]'
  ];
  const LOGIN_AGREEMENT_CONTROL_SELECTORS = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    '[data-slot="checkbox"]'
  ];

  function getHumanVerificationProbeConfig() {
    return {
      textPatternSource: HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE,
      selectors: HUMAN_VERIFICATION_SELECTORS.slice()
    };
  }

  function hasHumanVerificationSignal({ text = '', selectorMatches = [] } = {}) {
    const pattern = new RegExp(HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE, 'i');
    return pattern.test(String(text || '')) ||
      (Array.isArray(selectorMatches) && selectorMatches.length > 0);
  }

  function normalizeTargetDomain(domain) {
    try {
      if (!domain) return '';
      const value = String(domain || '').trim().toLowerCase();
      if (!value) return '';
      if (/^https?:\/\//i.test(value)) return new URL(value).hostname.toLowerCase();
      return value.replace(/\/.*$/, '');
    } catch (e) {
      return String(domain || '').trim().toLowerCase();
    }
  }

  function hasOAuthCallbackCredential(url, extraParams = []) {
    try {
      const parsed = new URL(url || '');
      const params = new Set([...OAUTH_CALLBACK_CREDENTIAL_PARAMS, ...(extraParams || [])].map(name => String(name).toLowerCase()));
      for (const [name, value] of parsed.searchParams.entries()) {
        if (params.has(String(name).toLowerCase()) && String(value || '').trim() !== '') {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function isTargetSiteLoginPage(url, domain, options = {}) {
    try {
      const parsed = new URL(url || '');
      const targetDomain = normalizeTargetDomain(domain);
      if (!targetDomain || parsed.hostname.toLowerCase() !== targetDomain) return false;
      if (!LOGIN_ROUTE_PATTERN.test(parsed.pathname)) return false;
      return !hasOAuthCallbackCredential(url, options.extraCallbackParams || []);
    } catch (e) {
      return false;
    }
  }

  function getLoginAgreementProbeConfig() {
    return {
      agreementPatternSource: LOGIN_AGREEMENT_PATTERN_SOURCE,
      negativePatternSource: LOGIN_AGREEMENT_NEGATIVE_PATTERN_SOURCE,
      humanVerificationTextPatternSource: HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE,
      controlSelectors: LOGIN_AGREEMENT_CONTROL_SELECTORS.slice(),
      skipSelectors: LOGIN_AGREEMENT_SKIP_SELECTORS.slice()
    };
  }

  function isLoginAgreementText(text) {
    const normalized = normalizeControlText(text);
    if (!normalized || normalized.length > 260) return false;
    if (hasHumanVerificationSignal({ text: normalized })) return false;
    const negativePattern = new RegExp(LOGIN_AGREEMENT_NEGATIVE_PATTERN_SOURCE, 'i');
    if (negativePattern.test(normalized)) return false;
    const agreementPattern = new RegExp(LOGIN_AGREEMENT_PATTERN_SOURCE, 'i');
    return agreementPattern.test(normalized);
  }

  function shouldUseLoginAgreementHelperForUrl(url, domain) {
    try {
      const parsed = new URL(url || '');
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === 'linux.do' || hostname.endsWith('.linux.do')) return false;
      if (/oauth|authorize|auth\/oauth/.test(parsed.pathname.toLowerCase())) return false;
      return isTargetSiteLoginPage(url, domain);
    } catch (e) {
      return false;
    }
  }

  function shouldSkipOrdinaryDialogCleanupForUrl(url) {
    try {
      const parsed = new URL(url || '');
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      if (hostname === 'linux.do' || hostname.endsWith('.linux.do')) return true;
      if (hostname === 'connect.linux.do') return true;
      if (isTargetSiteLoginPage(parsed.href, hostname)) return true;
      if (/oauth|authorize|auth\/oauth/.test(pathname)) return true;
      return false;
    } catch (e) {
      return true;
    }
  }

  function normalizeControlText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isOrdinaryDialogCloseText(text) {
    const normalized = normalizeControlText(text);
    if (!normalized || normalized.length > 40) return false;
    if (hasHumanVerificationSignal({ text: normalized })) return false;
    if (/linux\s*\.?\s*do|oauth|authorize|授权|允许|登录|login|verify|验证/i.test(normalized)) return false;
    return /^(×|x|X|关闭|取消|我知道了|知道了|好的|确定|OK|Ok|ok|Close|Dismiss|Got it)$/i.test(normalized);
  }

  function buildHumanVerificationNotificationKey(tabId, url, reason = 'security-check') {
    return `${tabId || ''}:${url || ''}:${reason || 'security-check'}`;
  }

  function shouldNotifyHumanVerification({
    tabId,
    url,
    reason = 'security-check',
    now = Date.now(),
    lastNotification = null,
    throttleMs = HUMAN_VERIFICATION_FOCUS_THROTTLE_MS
  } = {}) {
    const key = buildHumanVerificationNotificationKey(tabId, url, reason);
    if (!lastNotification || lastNotification.key !== key) return true;
    return Number(now) - Number(lastNotification.notifiedAt || 0) >= throttleMs;
  }

  function buildHumanVerificationResult(message = '站点要求完成人机验证，自动签到已停止') {
    return {
      success: false,
      requiresSecurityCheck: true,
      message,
      httpStatus: 403,
      data: { kind: 'security-check' }
    };
  }

  function getSub2ApiOAuthRedirectFallback(currentUrl = '') {
    try {
      const parsed = new URL(currentUrl || '');
      const redirect = parsed.searchParams.get('redirect');
      if (redirect && redirect.startsWith('/')) return redirect;
      if (parsed.pathname && !/^\/login(?:\/|$)/i.test(parsed.pathname)) {
        return `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}` || '/check-in';
      }
      return '/check-in';
    } catch (e) {
      return '/check-in';
    }
  }

  function isSub2ApiPageFirstLoginUrl(url, domain) {
    if (typeof root.isSub2ApiTargetLoginPage === 'function') {
      return root.isSub2ApiTargetLoginPage(url, domain);
    }
    return isTargetSiteLoginPage(url, domain);
  }

  function getSub2ApiPageFirstReturnUrl(domain, visitUrl = null) {
    if (typeof root.getSub2ApiPostLoginUrl === 'function') {
      return root.getSub2ApiPostLoginUrl(domain, visitUrl);
    }
    return `https://${domain}${getSub2ApiOAuthRedirectFallback(visitUrl)}`;
  }

  function shouldRefreshBalanceAfterPageResult(pageResult = {}, options = {}) {
    if (options.forceRefresh === true) return true;
    return Boolean(pageResult.clickedText || pageResult.data?.clickedText);
  }

  root.getHumanVerificationProbeConfig = getHumanVerificationProbeConfig;
  root.hasHumanVerificationSignal = hasHumanVerificationSignal;
  root.hasOAuthCallbackCredential = hasOAuthCallbackCredential;
  root.isTargetSiteLoginPage = isTargetSiteLoginPage;
  root.getLoginAgreementProbeConfig = getLoginAgreementProbeConfig;
  root.isLoginAgreementText = isLoginAgreementText;
  root.shouldUseLoginAgreementHelperForUrl = shouldUseLoginAgreementHelperForUrl;
  root.shouldSkipOrdinaryDialogCleanupForUrl = shouldSkipOrdinaryDialogCleanupForUrl;
  root.isOrdinaryDialogCloseText = isOrdinaryDialogCloseText;
  root.buildHumanVerificationNotificationKey = buildHumanVerificationNotificationKey;
  root.shouldNotifyHumanVerification = shouldNotifyHumanVerification;
  root.buildHumanVerificationResult = buildHumanVerificationResult;
  root.isSub2ApiPageFirstLoginUrl = isSub2ApiPageFirstLoginUrl;
  root.getSub2ApiPageFirstReturnUrl = getSub2ApiPageFirstReturnUrl;
  root.shouldRefreshBalanceAfterPageResult = shouldRefreshBalanceAfterPageResult;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getHumanVerificationProbeConfig,
      hasHumanVerificationSignal,
      hasOAuthCallbackCredential,
      isTargetSiteLoginPage,
      getLoginAgreementProbeConfig,
      isLoginAgreementText,
      shouldUseLoginAgreementHelperForUrl,
      shouldSkipOrdinaryDialogCleanupForUrl,
      isOrdinaryDialogCloseText,
      buildHumanVerificationNotificationKey,
      shouldNotifyHumanVerification,
      buildHumanVerificationResult,
      isSub2ApiPageFirstLoginUrl,
      getSub2ApiPageFirstReturnUrl,
      shouldRefreshBalanceAfterPageResult
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
