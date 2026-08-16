/**
 * 站点档案（Site Profile）——声明式站点配置。
 * 见 dev/02-方案设计.md 第 3 节。
 *
 * 核心思想：把「签到方式」拆成两个正交维度：
 *   - 认证维度 AuthStrategy：如何拿到「已登录」状态
 *   - 签到维度 CheckinStrategy：拿到登录态后如何触发签到
 */

/** 认证策略：如何获得登录态 */
export type AuthStrategy =
  | 'cookie' // 直接复用浏览器已有 cookie，不做登录动作（场景 A）
  | 'session-reuse' // 探测登录态，有效则复用，无效才升级
  | 'oauth-linuxdo' // 走 linux.do OAuth 换取 token/session
  | 'token-storage' // 从页面 localStorage/sessionStorage 读取 token
  | 'force-relogin'; // 每次签到前强制重新登录（场景 B）

/** 签到策略：如何触发签到 */
export type CheckinStrategy =
  | 'api' // 用认证头向签到接口发请求
  | 'visit' // 仅带 cookie 打开页面，读余额视为成功（场景 A）
  | 'page-click' // 打开页面，按选择器/文案查找并点击签到按钮（场景 C）
  | 'manual-assist'; // 前置页面交用户手动完成（场景 C 人工兜底）

/** 站点预设：仅用于填充默认策略与接口路径 */
export type SitePreset = 'newapi' | 'sub2api' | 'zenapi' | 'custom';

/** OAuth 登录提供方（重新登录时点击哪个第三方登录入口） */
export type OAuthProvider = 'linuxdo' | 'github';

export interface SiteAuthConfig {
  strategy: AuthStrategy;
  /** token-storage：localStorage / sessionStorage 的 key 候选 */
  tokenKeys?: string[];
  /** 语义糖：等价于 strategy = 'force-relogin' */
  forceReloginEveryRun?: boolean;
  /** OAuth 登录提供方，默认 linuxdo */
  oauthProvider?: OAuthProvider;
}

export interface SiteApiConfig {
  execUrl: string;
  method: 'GET' | 'POST';
  params?: Record<string, unknown>;
  /** 二次核验接口 */
  queryUrl?: string;
  /** HTTP 2xx 即视为成功（部分站点无标准 success 字段） */
  successOnHttpOk?: boolean;
}

export interface SiteClickConfig {
  /**
   * 点击步骤（有序）：从当前页面出发依次点击每一步，直到触发签到。
   * 每一项先当 CSS 选择器，匹配不到再当可见文案。最后一步通常即签到按钮。
   * 存在 steps 时优先使用；为空则回退到 selectors/navSteps/内置文案自动识别。
   */
  steps?: string[];
  /** 每步点击之间的等待毫秒，默认 1500 */
  stepDelayMs?: number;
  /** 用户指定的按钮选择器，优先于内置文案匹配（legacy / 自动模式） */
  selectors?: string[];
  /** 追加文案（与内置文案合并） */
  textPatterns?: string[];
  /** legacy：到达签到位置前依次点击的导航目标（已由 steps 取代） */
  navSteps?: string[];
  /** 每个导航步骤之后的等待毫秒，默认 1500 */
  navStepDelayMs?: number;
  /** 找不到按钮 / 需人工时，把标签页保留并切到前台 */
  keepTabForManual?: boolean;
  waitTimeoutMs?: number;
}

export interface SiteCheckinConfig {
  strategy: CheckinStrategy;
  /** 签到页 / 访问页完整 URL */
  pageUrl: string;
  api?: SiteApiConfig;
  click?: SiteClickConfig;
}

export interface SiteBalanceConfig {
  queryUrls?: string[];
  pageSelectors?: string[];
}

export interface SiteProfile {
  id: string; // 站点唯一 ID（域名派生：点 -> 下划线）
  domain: string; // cookie 域名
  name: string; // 展示名
  enabled: boolean;
  order: number; // 列表排序
  preset: SitePreset;
  auth: SiteAuthConfig;
  checkin: SiteCheckinConfig;
  humanVerification?: {
    focusWindowOnDetect?: boolean;
  };
  balance?: SiteBalanceConfig;
}
