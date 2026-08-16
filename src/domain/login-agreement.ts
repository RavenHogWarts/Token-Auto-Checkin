/**
 * 登录页「同意协议」勾选配置。移植自 reference/page-automation.js。
 */
import { HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE } from './human-verification';
import type { LoginAgreementConfig } from '../page/click-login';

const AGREEMENT_PATTERN_SOURCE = [
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
  'policy',
].join('|');

const NEGATIVE_PATTERN_SOURCE = [
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
  'updates',
].join('|');

const SKIP_SELECTORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="google.com/recaptcha"]',
  'iframe[src*="hcaptcha.com"]',
  '.cf-turnstile',
  '.g-recaptcha',
  '.h-captcha',
  '[data-sitekey]',
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  '[class*="turnstile" i]',
  '[id*="turnstile" i]',
];

const CONTROL_SELECTORS = [
  'input[type="checkbox"]',
  '[role="checkbox"]',
  '[data-slot="checkbox"]',
];

export function getLoginAgreementProbeConfig(): LoginAgreementConfig {
  return {
    agreementPatternSource: AGREEMENT_PATTERN_SOURCE,
    negativePatternSource: NEGATIVE_PATTERN_SOURCE,
    humanVerificationTextPatternSource: HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE,
    controlSelectors: CONTROL_SELECTORS.slice(),
    skipSelectors: SKIP_SELECTORS.slice(),
  };
}
