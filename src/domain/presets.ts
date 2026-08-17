/**
 * 站点预设默认值 + Profile 构建 + 旧配置迁移。
 * 见 dev/02-方案设计.md 第 3.1 / 7 节。
 */
import type {
  AuthStrategy,
  CheckinStrategy,
  SiteAuthConfig,
  SiteCheckinConfig,
  SitePreset,
  SiteProfile,
} from './site-profile';

export function siteIdFromDomain(domain: string): string {
  return domain.replace(/\./g, '_');
}

interface PresetDefaults {
  auth: AuthStrategy;
  checkin: CheckinStrategy;
  tokenKeys?: string[];
  pagePath: string;
  apiExecPath?: string;
  apiMethod?: 'GET' | 'POST';
  apiQueryPath?: string;
}

/** 各预设的默认策略与接口路径（移植自 reference/config.js 的 buildSiteConfig 映射） */
export const PRESET_DEFAULTS: Record<SitePreset, PresetDefaults> = {
  newapi: {
    auth: 'session-reuse',
    checkin: 'api',
    pagePath: '/console/personal',
    apiExecPath: '/api/user/checkin',
    apiMethod: 'POST',
    apiQueryPath: '/api/user/checkin',
  },
  'newapi-profile': {
    // New API rc.23 个人资料签到：token 仅在内存 → bearer-sniff 嗅探 Authorization；
    // 签到走原生 API（在标签页内执行以带上 Cloudflare cf_clearance），入口在 /profile。
    auth: 'bearer-sniff',
    checkin: 'api',
    pagePath: '/profile',
    apiExecPath: '/api/user/checkin',
    apiMethod: 'POST',
    apiQueryPath: '/api/user/checkin',
  },
  sub2api: {
    auth: 'token-storage',
    checkin: 'page-click',
    tokenKeys: ['auth_token', 'access_token', 'token'],
    pagePath: '/check-in',
    apiExecPath: '/api/v1/user/check-in',
    apiMethod: 'POST',
  },
  zenapi: {
    auth: 'token-storage',
    checkin: 'api',
    tokenKeys: ['user_token'],
    pagePath: '/user',
    apiExecPath: '/api/u/checkin',
    apiMethod: 'POST',
    apiQueryPath: '/api/u/dashboard',
  },
  custom: {
    auth: 'cookie',
    checkin: 'visit',
    pagePath: '/',
  },
};

export interface BuildProfileInput {
  domain: string;
  name?: string;
  preset?: SitePreset;
  enabled?: boolean;
  order?: number;
  pageUrl?: string;
  /** 覆盖项（高级配置） */
  auth?: Partial<SiteAuthConfig>;
  checkin?: Partial<SiteCheckinConfig>;
}

/** 从最小输入构建完整 SiteProfile，未指定字段用 preset 默认值补齐 */
export function buildSiteProfile(input: BuildProfileInput): SiteProfile {
  const domain = input.domain.trim().toLowerCase();
  const preset: SitePreset = input.preset ?? 'newapi';
  const defaults = PRESET_DEFAULTS[preset];
  const pageUrl = input.pageUrl || `https://${domain}${defaults.pagePath}`;

  const auth: SiteAuthConfig = {
    strategy: input.auth?.strategy ?? defaults.auth,
    ...(defaults.tokenKeys ? { tokenKeys: defaults.tokenKeys } : {}),
    ...input.auth,
  };
  if (auth.forceReloginEveryRun) auth.strategy = 'force-relogin';

  const checkin: SiteCheckinConfig = {
    strategy: input.checkin?.strategy ?? defaults.checkin,
    pageUrl,
    ...input.checkin,
  };
  if (checkin.strategy === 'api' && !checkin.api && defaults.apiExecPath) {
    checkin.api = {
      execUrl: `https://${domain}${defaults.apiExecPath}`,
      method: defaults.apiMethod ?? 'POST',
      ...(defaults.apiQueryPath
        ? { queryUrl: `https://${domain}${defaults.apiQueryPath}` }
        : {}),
    };
  }

  return {
    id: siteIdFromDomain(domain),
    domain,
    name: input.name?.trim() || domain,
    enabled: input.enabled !== false,
    order: input.order ?? 0,
    preset,
    auth,
    checkin,
  };
}
