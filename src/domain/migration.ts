/**
 * 旧版配置迁移。
 * 旧格式（reference/config.js）：{ domain, name, enabled, type, mode, pageUrl }
 *   type ∈ auto | newapi | sub2api | zenapi
 *   mode === 'visit' 表示仅访问
 * 见 dev/02-方案设计.md 第 7 节。
 */
import { buildSiteProfile } from './presets';
import type { SitePreset, SiteProfile } from './site-profile';

export interface LegacySite {
  domain?: string;
  name?: string;
  enabled?: boolean;
  type?: string;
  mode?: string;
  pageUrl?: string;
  autoSignTime?: string;
}

function legacyTypeToPreset(type: string | undefined): SitePreset {
  switch (type) {
    case 'sub2api':
      return 'sub2api';
    case 'zenapi':
      return 'zenapi';
    case 'newapi':
      return 'newapi';
    // 'auto' 旧语义为运行时探测，迁移时以 newapi 为基线（含页面兜底能力）
    default:
      return 'newapi';
  }
}

export function migrateLegacySite(legacy: LegacySite, order = 0): SiteProfile | null {
  const domain = String(legacy.domain || '')
    .trim()
    .toLowerCase();
  if (!domain || !domain.includes('.')) return null;

  const isVisit = legacy.mode === 'visit';
  const preset: SitePreset = isVisit ? 'custom' : legacyTypeToPreset(legacy.type);

  return buildSiteProfile({
    domain,
    name: legacy.name,
    preset,
    enabled: legacy.enabled,
    order,
    pageUrl: legacy.pageUrl,
    ...(isVisit ? { auth: { strategy: 'cookie' }, checkin: { strategy: 'visit' } } : {}),
  });
}

export function migrateLegacySites(sites: LegacySite[]): SiteProfile[] {
  const seen = new Set<string>();
  const result: SiteProfile[] = [];
  sites.forEach((legacy) => {
    const profile = migrateLegacySite(legacy, result.length);
    if (!profile || seen.has(profile.domain)) return;
    seen.add(profile.domain);
    result.push(profile);
  });
  return result;
}
