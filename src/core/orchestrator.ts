/** 签到编排：批量 / 单站执行、取消、进度与 badge。移植自 reference/background.js。 */
import { browser } from '#imports';
import type { CheckinResult } from '../domain/checkin-result';
import type { CheckinResults, CheckinRunState } from '../domain/messages';
import { idleRunState } from '../domain/messages';
import type { SiteProfile } from '../domain/site-profile';
import {
  loadProfiles,
  loadResults,
  saveResults,
  saveRunState,
  setLastCheckInTime,
} from '../services/storage';
import { appendLog, type LogLevel } from '../services/run-log';
import { createLogger } from '../shared/logger';
import { sleep } from '../shared/time';
import type { CancelToken, RunContext } from './context';
import { isCancelRequested, requestCancel } from './context';
import { createSiteTabSession } from './tab-session';
import { runSiteCheckin } from './pipeline';

const logger = createLogger('orchestrator');

interface ActiveRun {
  promise: Promise<CheckinResults>;
  cancelToken: CancelToken;
  tabSession: { close(): Promise<void> } | null;
}
let activeRun: ActiveRun | null = null;

export function isRunning(): boolean {
  return activeRun !== null;
}

function runningState(partial: Partial<CheckinRunState>): CheckinRunState {
  return {
    running: true,
    total: 0,
    current: 0,
    currentSiteId: null,
    startedAt: new Date().toISOString(),
    ...partial,
  };
}

function markChecking(results: CheckinResults, siteId: string): CheckinResults {
  return { ...results, [siteId]: { status: 'checking', message: '签到中' } };
}

const STATUS_TEXT: Record<string, string> = {
  success: '成功',
  already: '已签',
  failed: '失败',
  invalid: '失效',
  'needs-human': '待人工',
};

function logResult(name: string, r: CheckinResult): Promise<void> {
  const level: LogLevel =
    r.status === 'success'
      ? 'success'
      : r.status === 'already'
        ? 'info'
        : r.status === 'needs-human'
          ? 'warn'
          : 'error';
  const balance = r.balance ? `（余额 ${r.balance}）` : '';
  return appendLog(level, `${STATUS_TEXT[r.status] ?? r.status}：${r.message}${balance}`, {
    site: name,
  });
}

async function setBadge(text: string, color: string): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color });
    await browser.action.setBadgeText({ text });
  } catch {
    /* action API 不可用时忽略 */
  }
}

async function finalizeBadge(results: CheckinResults): Promise<void> {
  const vals = Object.values(results);
  const failed = vals.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
  const success = vals.filter((r) => r.status === 'success').length;
  if (failed > 0) await setBadge(`✗${failed}`, '#dc3545');
  else if (success > 0) await setBadge('✓', '#28a745');
  else await setBadge('✓', '#17a2b8');
  setTimeout(() => void browser.action.setBadgeText({ text: '' }).catch(() => undefined), 5000);
}

async function runOneSite(
  profile: SiteProfile,
  results: CheckinResults,
  cancelToken: CancelToken,
): Promise<CheckinResult> {
  const tabSession = createSiteTabSession();
  if (activeRun) activeRun.tabSession = tabSession;
  const ctx: RunContext = { tabSession, cancelToken, logger: createLogger(profile.name) };
  let result: CheckinResult = { status: 'failed', message: '未执行' };
  try {
    result = await runSiteCheckin(profile, ctx);
  } catch (e) {
    result = { status: 'failed', message: (e as Error).message };
  } finally {
    // needs-human 时保留标签页交用户处理，其余关闭
    if (!result.requiresManual) {
      await tabSession.close();
    }
    if (activeRun?.tabSession === tabSession) activeRun.tabSession = null;
  }
  return result;
}

async function executeAll(
  source: CheckinRunState['source'],
  cancelToken: CancelToken,
): Promise<CheckinResults> {
  const profiles = (await loadProfiles()).filter((p) => p.enabled);
  const total = profiles.length;
  let current = 0;
  const results: CheckinResults = {};

  await saveRunState(runningState({ total, source }));
  await setBadge(`0/${total}`, '#667eea');
  await appendLog('info', `开始${source === 'schedule' ? '定时' : '批量'}签到（共 ${total} 个启用站点）`);

  for (const profile of profiles) {
    if (isCancelRequested(cancelToken)) break;
    current++;
    await setBadge(`${current}/${total}`, '#667eea');
    await saveRunState(runningState({ total, current, currentSiteId: profile.id, source }));
    await saveResults(markChecking(results, profile.id));
    await appendLog('info', `开始签到（${current}/${total}）`, { site: profile.name });

    const result = await runOneSite(profile, results, cancelToken);
    results[profile.id] = isCancelRequested(cancelToken)
      ? { status: 'failed', message: '签到中断' }
      : result;
    await saveResults(results);
    await logResult(profile.name, results[profile.id]!);

    if (isCancelRequested(cancelToken)) break;
    await sleep(2000);
  }

  const success = Object.values(results).filter((r) => r.status === 'success').length;
  const failed = Object.values(results).filter(
    (r) => r.status === 'failed' || r.status === 'invalid',
  ).length;
  await setLastCheckInTime(new Date().toISOString());
  await saveResults(results);
  await saveRunState(idleRunState());
  await finalizeBadge(results);
  await appendLog(
    failed > 0 ? 'warn' : 'success',
    `本轮结束：成功 ${success}，失败/失效 ${failed}`,
  );
  return results;
}

async function executeSingle(siteId: string, cancelToken: CancelToken): Promise<CheckinResults> {
  const profile = (await loadProfiles()).find((p) => p.id === siteId);
  if (!profile) throw new Error('未找到要重试的站点');
  if (!profile.enabled) throw new Error('站点已禁用，请启用后重试');

  await saveRunState(runningState({ total: 1, current: 1, currentSiteId: siteId, source: 'retry' }));
  const base = await loadResults();
  await saveResults(markChecking(base, siteId));
  await appendLog('info', '开始单站重试', { site: profile.name });

  const result = await runOneSite(profile, base, cancelToken);
  const latest = await loadResults();
  const finalResult: CheckinResult = isCancelRequested(cancelToken)
    ? { status: 'failed', message: '签到中断' }
    : result;
  const next = { ...latest, [siteId]: finalResult } as CheckinResults;

  await saveResults(next);
  await saveRunState(idleRunState());
  await setLastCheckInTime(new Date().toISOString());
  await logResult(profile.name, finalResult);
  return next;
}

function start(runner: (token: CancelToken) => Promise<CheckinResults>): Promise<CheckinResults> {
  if (activeRun) {
    logger.log('已有签到任务在执行，跳过重复触发');
    return activeRun.promise;
  }
  const cancelToken: CancelToken = { requested: false, requestedAt: null };
  const run: ActiveRun = { cancelToken, tabSession: null, promise: Promise.resolve({}) };
  activeRun = run;
  run.promise = runner(cancelToken).finally(() => {
    if (activeRun === run) activeRun = null;
  });
  return run.promise;
}

export function startBatchRun(source: CheckinRunState['source'] = 'manual'): Promise<CheckinResults> {
  return start((token) => executeAll(source, token));
}

export function startSingleRun(siteId: string): Promise<CheckinResults> {
  return start((token) => executeSingle(siteId, token));
}

export async function cancelRun(): Promise<{ results: CheckinResults; runState: CheckinRunState }> {
  if (activeRun) {
    requestCancel(activeRun.cancelToken);
    await activeRun.tabSession?.close?.();
  }
  const results = await loadResults();
  await saveRunState(idleRunState());
  return { results, runState: idleRunState() };
}

