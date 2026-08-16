const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getHumanVerificationProbeConfig,
  getLoginAgreementProbeConfig,
  hasHumanVerificationSignal,
  isLoginAgreementText,
  isTargetSiteLoginPage,
  shouldSkipOrdinaryDialogCleanupForUrl,
  isOrdinaryDialogCloseText,
  shouldNotifyHumanVerification,
  shouldUseLoginAgreementHelperForUrl,
  buildHumanVerificationResult,
  isSub2ApiPageFirstLoginUrl,
  getSub2ApiPageFirstReturnUrl,
  shouldRefreshBalanceAfterPageResult
} = require('./page-automation.js');

test('detects human verification from page text and selectors', () => {
  assert.equal(hasHumanVerificationSignal({
    text: '请完成安全验证 verify you are human'
  }), true);
  assert.equal(hasHumanVerificationSignal({
    selectorMatches: ['iframe[src*="challenges.cloudflare.com"]']
  }), true);
  assert.equal(hasHumanVerificationSignal({
    text: '每日签到 领取奖励',
    selectorMatches: []
  }), false);
});

test('exposes reusable human verification probe config', () => {
  const config = getHumanVerificationProbeConfig();

  assert.ok(config.textPatternSource.includes('Turnstile'));
  assert.ok(config.selectors.includes('.cf-turnstile'));
  assert.ok(config.selectors.includes('iframe[src*="recaptcha.net/recaptcha"]'));
});

test('skips ordinary dialog cleanup on OAuth and login surfaces', () => {
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://connect.linux.do/oauth/authorize'), true);
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://linux.do/login'), true);
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://sub.example.com/login'), true);
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://sub.example.com/sign-in'), true);
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://sub.example.com/signin'), true);
  assert.equal(shouldSkipOrdinaryDialogCleanupForUrl('https://sub.example.com/check-in'), false);
});

test('classifies target-site login routes and excludes OAuth callbacks', () => {
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/login', 'sub.example.com'), true);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/login/otp', 'sub.example.com'), true);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/sign-in', 'sub.example.com'), true);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/signin?redirect=/check-in', 'sub.example.com'), true);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/login?code=abc&state=xyz', 'sub.example.com'), false);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/sign-in?linuxdo_token=abc.def', 'sub.example.com'), false);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/signin?token=abc', 'sub.example.com'), false);
  assert.equal(isTargetSiteLoginPage('https://other.example.com/login', 'sub.example.com'), false);
  assert.equal(isTargetSiteLoginPage('https://sub.example.com/api/auth/signin', 'sub.example.com'), false);
});

test('limits login agreement handling to target-site login pages', () => {
  assert.equal(shouldUseLoginAgreementHelperForUrl('https://sub.example.com/login', 'sub.example.com'), true);
  assert.equal(shouldUseLoginAgreementHelperForUrl('https://sub.example.com/sign-in', 'sub.example.com'), true);
  assert.equal(shouldUseLoginAgreementHelperForUrl('https://sub.example.com/check-in', 'sub.example.com'), false);
  assert.equal(shouldUseLoginAgreementHelperForUrl('https://connect.linux.do/oauth2/authorize', 'sub.example.com'), false);
  assert.equal(shouldUseLoginAgreementHelperForUrl('https://linux.do/login', 'sub.example.com'), false);
});

test('matches login agreement checkbox text without accepting unrelated or verification text', () => {
  assert.equal(isLoginAgreementText('我已阅读并同意用户协议和隐私政策'), true);
  assert.equal(isLoginAgreementText('I agree to the Terms of Service and Privacy Policy'), true);
  assert.equal(isLoginAgreementText('接受服务条款'), true);
  assert.equal(isLoginAgreementText('记住我'), false);
  assert.equal(isLoginAgreementText('Subscribe to product updates'), false);
  assert.equal(isLoginAgreementText('verify you are human before continuing'), false);
});

test('login agreement config supports custom role checkbox controls', () => {
  const config = getLoginAgreementProbeConfig();

  assert.ok(config.controlSelectors.includes('input[type="checkbox"]'));
  assert.ok(config.controlSelectors.includes('[role="checkbox"]'));
  assert.ok(config.controlSelectors.includes('[data-slot="checkbox"]'));
});

test('recognizes ordinary close controls without matching verification actions', () => {
  assert.equal(isOrdinaryDialogCloseText('关闭'), true);
  assert.equal(isOrdinaryDialogCloseText('×'), true);
  assert.equal(isOrdinaryDialogCloseText('我知道了'), true);
  assert.equal(isOrdinaryDialogCloseText('Authorize linux.do'), false);
  assert.equal(isOrdinaryDialogCloseText('verify you are human'), false);
});

test('throttles repeated human verification notifications by detection key', () => {
  const last = { key: '1:https://sub.example.com/login:security-check', notifiedAt: 1000 };
  assert.equal(shouldNotifyHumanVerification({
    tabId: 1,
    url: 'https://sub.example.com/login',
    reason: 'security-check',
    now: 2000,
    lastNotification: last
  }), false);
  assert.equal(shouldNotifyHumanVerification({
    tabId: 1,
    url: 'https://sub.example.com/login',
    reason: 'security-check',
    now: 7000,
    lastNotification: last
  }), true);
});

test('builds security-check results for automation flow stops', () => {
  assert.deepEqual(buildHumanVerificationResult(), {
    success: false,
    requiresSecurityCheck: true,
    message: '站点要求完成人机验证，自动签到已停止',
    httpStatus: 403,
    data: { kind: 'security-check' }
  });
});

test('resolves Sub2API page-first login and return URLs', () => {
  assert.equal(isSub2ApiPageFirstLoginUrl('https://sub.example.com/login?next=/check-in', 'sub.example.com'), true);
  assert.equal(isSub2ApiPageFirstLoginUrl('https://sub.example.com/check-in', 'sub.example.com'), false);
  assert.equal(
    getSub2ApiPageFirstReturnUrl('sub.example.com', 'https://sub.example.com/check-in?tab=daily'),
    'https://sub.example.com/check-in?tab=daily'
  );
});

test('forces Sub2API page result refresh while keeping default fallback behavior conditional', () => {
  assert.equal(shouldRefreshBalanceAfterPageResult({ kind: 'already' }, { forceRefresh: true }), true);
  assert.equal(shouldRefreshBalanceAfterPageResult({ kind: 'already' }, { forceRefresh: false }), false);
  assert.equal(shouldRefreshBalanceAfterPageResult({ clickedText: '签到' }, { forceRefresh: false }), true);
});
