/**
 * 人机验证探测配置与结果构建（纯常量/函数，在 background 使用）。
 * 移植自 reference/page-automation.js。
 */
import type { CheckinResult } from './checkin-result';

export const HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE = [
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
  'Cloudflare',
].join('|');

export const HUMAN_VERIFICATION_SELECTORS = [
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
  'textarea[name="h-captcha-response"]',
];

export interface HumanVerificationProbeConfig {
  textPatternSource: string;
  selectors: string[];
}

export function getHumanVerificationProbeConfig(): HumanVerificationProbeConfig {
  return {
    textPatternSource: HUMAN_VERIFICATION_TEXT_PATTERN_SOURCE,
    selectors: HUMAN_VERIFICATION_SELECTORS.slice(),
  };
}

export function buildHumanVerificationResult(
  message = '站点要求完成人机验证，自动签到已停止',
): CheckinResult {
  return { status: 'needs-human', message, requiresManual: true };
}
