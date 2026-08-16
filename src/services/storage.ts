/**
 * 类型化 storage 封装 + 旧配置迁移。
 * 见 dev/04-架构设计.md 第 4 节。
 */
import { browser } from '#imports';
import type { CheckinResult } from '../domain/checkin-result';
import type { CheckinResults, CheckinRunState } from '../domain/messages';
import { idleRunState } from '../domain/messages';
import { migrateLegacySites, type LegacySite } from '../domain/migration';
import type { SiteProfile } from '../domain/site-profile';
import { DEFAULT_AUTO_SIGN_TIME, isValidAutoSignTime } from '../shared/time';

const KEYS = {
  siteProfiles: 'siteProfiles',
  checkInResults: 'checkInResults',
  authHeadersCache: 'authHeadersCache',
  runState: 'runState',
  lastCheckInTime: 'lastCheckInTime',
  autoSignTime: 'autoSignTime',
  focusHumanVerificationWindow: 'focusHumanVerificationWindow',
  legacySites: 'userSites',
  legacyBackup: 'legacyBackup',
  migrated: 'migratedToV2',
  pendingPick: 'pendingPick',
} as const;

async function get<T>(key: string, fallback: T): Promise<T> {
  const data = await browser.storage.local.get(key);
  const value = (data as Record<string, unknown>)[key];
  return value === undefined ? fallback : (value as T);
}

async function set(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function loadProfiles(): Promise<SiteProfile[]> {
  const profiles = await get<SiteProfile[]>(KEYS.siteProfiles, []);
  return Array.isArray(profiles) ? [...profiles].sort((a, b) => a.order - b.order) : [];
}

export async function saveProfiles(profiles: SiteProfile[]): Promise<void> {
  const normalized = profiles.map((p, i) => ({ ...p, order: i }));
  await set(KEYS.siteProfiles, normalized);
}

export async function getProfile(siteId: string): Promise<SiteProfile | null> {
  const profiles = await loadProfiles();
  return profiles.find((p) => p.id === siteId) ?? null;
}

export async function loadResults(): Promise<CheckinResults> {
  return get<CheckinResults>(KEYS.checkInResults, {});
}

export async function saveResults(results: CheckinResults): Promise<void> {
  await set(KEYS.checkInResults, results);
}

export async function updateResult(siteId: string, result: CheckinResult): Promise<CheckinResults> {
  const results = await loadResults();
  const next = { ...results, [siteId]: result };
  await saveResults(next);
  return next;
}

export async function loadRunState(): Promise<CheckinRunState> {
  return get<CheckinRunState>(KEYS.runState, idleRunState());
}

export async function saveRunState(state: CheckinRunState): Promise<void> {
  await set(KEYS.runState, state);
}

export async function getLastCheckInTime(): Promise<string | null> {
  return get<string | null>(KEYS.lastCheckInTime, null);
}

export async function setLastCheckInTime(time: string): Promise<void> {
  await set(KEYS.lastCheckInTime, time);
}

export async function getAutoSignTime(): Promise<string> {
  const time = await get<string>(KEYS.autoSignTime, DEFAULT_AUTO_SIGN_TIME);
  return isValidAutoSignTime(time) ? time : DEFAULT_AUTO_SIGN_TIME;
}

export async function setAutoSignTime(time: string): Promise<void> {
  await set(KEYS.autoSignTime, time);
}

export async function getFocusHumanVerificationWindow(): Promise<boolean> {
  return (await get<boolean>(KEYS.focusHumanVerificationWindow, false)) === true;
}

export async function setFocusHumanVerificationWindow(value: boolean): Promise<void> {
  await set(KEYS.focusHumanVerificationWindow, value === true);
}

/** 认证头缓存（7 天过期），移植自 reference/background.js。 */
export interface CachedHeadersEntry {
  headers: Record<string, string>;
  cachedAt: number;
}
const AUTH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function getCachedHeaders(siteId: string): Promise<Record<string, string> | null> {
  const cache = await get<Record<string, CachedHeadersEntry>>(KEYS.authHeadersCache, {});
  const entry = cache[siteId];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > AUTH_CACHE_TTL_MS) return null;
  return entry.headers;
}

export async function cacheHeaders(siteId: string, headers: Record<string, string>): Promise<void> {
  const cache = await get<Record<string, CachedHeadersEntry>>(KEYS.authHeadersCache, {});
  cache[siteId] = { headers, cachedAt: Date.now() };
  await set(KEYS.authHeadersCache, cache);
}

export async function clearCachedHeaders(siteId: string): Promise<void> {
  const cache = await get<Record<string, CachedHeadersEntry>>(KEYS.authHeadersCache, {});
  delete cache[siteId];
  await set(KEYS.authHeadersCache, cache);
}

/** 首次启动：把旧版 userSites 迁移为 siteProfiles（保留备份）。 */
export async function migrateLegacyIfNeeded(): Promise<void> {
  const migrated = await get<boolean>(KEYS.migrated, false);
  if (migrated) return;
  const legacy = await get<LegacySite[]>(KEYS.legacySites, []);
  const existing = await get<SiteProfile[]>(KEYS.siteProfiles, []);
  if (Array.isArray(legacy) && legacy.length > 0 && existing.length === 0) {
    await set(KEYS.legacyBackup, legacy);
    await saveProfiles(migrateLegacySites(legacy));
  }
  await set(KEYS.migrated, true);
}

/** 元素点选：跨弹窗关闭保存编辑草稿与已点选的选择器结果。 */
export type PickField = 'steps';

export interface PendingPick {
  field: PickField;
  mode: 'add' | 'edit';
  draft: SiteProfile;
  results: string[];
}

export async function getPendingPick(): Promise<PendingPick | null> {
  return get<PendingPick | null>(KEYS.pendingPick, null);
}

export async function setPendingPick(pick: PendingPick): Promise<void> {
  await set(KEYS.pendingPick, pick);
}

export async function clearPendingPick(): Promise<void> {
  await browser.storage.local.remove(KEYS.pendingPick);
}

export async function appendPickResult(selector: string): Promise<void> {
  const pick = await getPendingPick();
  if (!pick) return;
  if (!pick.results.includes(selector)) pick.results.push(selector);
  await set(KEYS.pendingPick, pick);
}
