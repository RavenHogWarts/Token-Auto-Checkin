/**
 * popup ↔ background 类型化消息协议。
 * 见 dev/04-架构设计.md 第 5 节。
 */
import type { CheckinResult } from './checkin-result';

export interface CheckinRunState {
  running: boolean;
  total: number;
  current: number;
  currentSiteId?: string | null;
  source?: 'manual' | 'schedule' | 'retry';
  cancelling?: boolean;
  startedAt?: string | null;
}

export type CheckinResults = Record<string, CheckinResult>;

/** popup -> background 请求消息 */
export type RequestMessage =
  | { type: 'checkin/manual' }
  | { type: 'checkin/retry-site'; siteId: string }
  | { type: 'checkin/cancel' }
  | { type: 'status/get' }
  | { type: 'settings/update-auto-sign-time'; time: string }
  | { type: 'site/activate-manual-tab'; siteId: string }
  | { type: 'site/start-pick'; pageUrl?: string };

/** 页面注入脚本 -> background 事件消息 */
export type EventMessage =
  | { type: 'event/human-verification-detected' }
  | { type: 'event/element-picked'; selector: string }
  | { type: 'event/element-pick-done' };

export type Message = RequestMessage | EventMessage;

export interface StatusResponse {
  lastCheckInTime: string | null;
  checkInResults: CheckinResults;
  runState: CheckinRunState;
  autoSignTime: string;
  focusHumanVerificationWindow: boolean;
}

export interface CheckinResponse {
  success: boolean;
  running: boolean;
  results?: CheckinResults;
  runState?: CheckinRunState;
  error?: string;
}

export function idleRunState(): CheckinRunState {
  return { running: false, total: 0, current: 0, currentSiteId: null };
}
