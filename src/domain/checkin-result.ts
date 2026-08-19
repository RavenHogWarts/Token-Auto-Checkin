/**
 * 签到结果模型与接口响应解析。
 * 见 dev/02-方案设计.md 第 5 节；解析逻辑移植自 reference/checkin-result.js。
 */
import type { AuthStrategy, CheckinStrategy } from './site-profile';

export type CheckinStatus =
  | 'success'
  | 'already'
  | 'checking'
  | 'failed'
  | 'invalid'
  | 'needs-human'
  | 'recorded'; // 仅记录站点，不参与自动签到

export interface CheckinResult {
  status: CheckinStatus;
  message: string;
  balance?: string;
  queryVerified?: boolean;
  strategyUsed?: { auth: AuthStrategy; checkin: CheckinStrategy };
  /** 提示用户去前台标签页手动完成 */
  requiresManual?: boolean;
}

/** 接口签到的原始解析结果（内部使用，尚未映射为 CheckinResult） */
export interface ParsedCheckinResponse {
  success: boolean;
  alreadyCheckedIn: boolean;
  message: string;
  httpStatus: number;
  data?: unknown;
  /** 站点要求在页面内点击操作 */
  requiresPageExecution?: boolean;
  /** 站点要求完成人机验证 */
  requiresSecurityCheck?: boolean;
  /** 页面失效（404/410 等） */
  invalidSite?: boolean;
  /** 请求异常信息 */
  error?: string;
  /** 页面兜底点击后标记成功 */
  fallbackClicked?: boolean;
}

const ALREADY_KEYWORDS = ['已签到', '已经签到', '已签过', '今日已签', 'already', '重复签到'];
const PAGE_EXECUTION_KEYWORDS = ['自动化脚本异常请求', '官方网页手动点击签到'];
const SECURITY_CHECK_KEYWORDS = ['Turnstile', '安全验证', '人机验证'];

function formatReward(reward: unknown): string | null {
  const value = Number(reward);
  if (!Number.isFinite(value)) return null;
  return value.toFixed(2);
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export function parseCheckInResponse(
  data: unknown,
  httpStatus: number,
  successOnHttpOk = false,
): ParsedCheckinResponse {
  const d = asRecord(data);
  const zenApiAlreadyCheckedIn = d.already_checked_in === true;
  const success =
    d.success === true ||
    d.status === 'success' ||
    d.ret === 1 ||
    d.code === 0 ||
    d.ok === true ||
    (successOnHttpOk && httpStatus >= 200 && httpStatus < 300);

  const reward = formatReward(d.reward);
  const rawMessage =
    (d.message as string) ||
    (d.msg as string) ||
    (zenApiAlreadyCheckedIn ? '今日已签到' : null) ||
    (reward ? `签到成功，获得 $${reward}` : null) ||
    (d.data as string) ||
    '签到完成';
  const msgStr = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);

  const alreadyCheckedIn =
    zenApiAlreadyCheckedIn || ALREADY_KEYWORDS.some((k) => msgStr.includes(k));
  const requiresPageExecution =
    !success && PAGE_EXECUTION_KEYWORDS.some((k) => msgStr.includes(k));
  const requiresSecurityCheck =
    !success && SECURITY_CHECK_KEYWORDS.some((k) => msgStr.includes(k));

  const result: ParsedCheckinResponse = {
    success: success || alreadyCheckedIn,
    alreadyCheckedIn,
    message: msgStr,
    httpStatus,
    data,
  };
  if (requiresPageExecution) result.requiresPageExecution = true;
  if (requiresSecurityCheck) result.requiresSecurityCheck = true;
  return result;
}

/** 是否应尝试官方页面兜底签到 */
export function shouldTryPageFallback(result: ParsedCheckinResponse): boolean {
  return Boolean(
    result && !result.success && !result.alreadyCheckedIn && !result.invalidSite,
  );
}

/** 把接口解析结果映射为对外的 CheckinResult */
export function toCheckinResult(parsed: ParsedCheckinResponse): CheckinResult {
  if (parsed.invalidSite) return { status: 'invalid', message: parsed.message || '站点页面失效' };
  if (parsed.requiresSecurityCheck) {
    return { status: 'needs-human', message: parsed.message, requiresManual: true };
  }
  if (parsed.error) return { status: 'failed', message: parsed.error };
  if (parsed.fallbackClicked && parsed.success) {
    return { status: 'success', message: parsed.message };
  }
  if (parsed.alreadyCheckedIn) return { status: 'already', message: parsed.message };
  return { status: parsed.success ? 'success' : 'failed', message: parsed.message };
}
