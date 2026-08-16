/**
 * 运行期上下文与策略契约。
 * 见 dev/04-架构设计.md 第 3 节。
 */
import type { CheckinResult } from '../domain/checkin-result';
import type {
  AuthStrategy,
  CheckinStrategy,
  SiteProfile,
} from '../domain/site-profile';
import type { HeaderMap } from '../shared/auth-headers';
import type { Logger } from '../shared/logger';

/** 认证步骤产出的上下文 */
export interface AuthContext {
  /** 认证头（可用于 background fetch） */
  headers?: HeaderMap;
  /** 已打开且处于登录态的标签页 */
  tabId?: number;
  /** 仅靠 cookie，无显式认证头 */
  cookieOnly?: boolean;
  /** 命中人机验证 */
  securityCheck?: boolean;
  /** 需在标签页内执行请求以绕过 Cloudflare（如 ZenAPI） */
  needsTabExecution?: boolean;
  /** HTTP 2xx 即视为成功 */
  successOnHttpOk?: boolean;
}

export interface CancelToken {
  requested: boolean;
  requestedAt: string | null;
}

export interface TabSessionOpenOptions {
  active?: boolean;
}

/** 临时后台标签页会话 */
export interface TabSession {
  owns(id: number | undefined): boolean;
  open(
    url: string,
    timeoutMs?: number,
    options?: TabSessionOpenOptions,
  ): Promise<chrome.tabs.Tab>;
  close(): Promise<void>;
}

/** 贯穿一次签到运行的上下文 */
export interface RunContext {
  tabSession: TabSession;
  cancelToken: CancelToken;
  logger: Logger;
}

export interface AuthStrategyImpl {
  name: AuthStrategy;
  resolve(profile: SiteProfile, ctx: RunContext): Promise<AuthContext | null>;
}

export interface CheckinStrategyImpl {
  name: CheckinStrategy;
  run(profile: SiteProfile, auth: AuthContext, ctx: RunContext): Promise<CheckinResult>;
}

export function isCancelRequested(token: CancelToken | null | undefined): boolean {
  return token?.requested === true;
}

export function requestCancel(token: CancelToken | null | undefined): void {
  if (!token) return;
  token.requested = true;
  token.requestedAt = token.requestedAt || new Date().toISOString();
}
