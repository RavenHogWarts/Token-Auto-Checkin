/** 消息路由：popup / 页面注入 → background。见 dev/04-架构设计.md 第 5 节。 */
import type {
  CheckinResponse,
  Message,
  StatusResponse,
} from '../domain/messages';
import { idleRunState } from '../domain/messages';
import { activateManualTab, handleDetectedMessage } from '../services/human-verification';
import { finishElementPick, recordPickedElement, startElementPick } from '../services/element-pick';
import { scheduleDailyCheckIn } from '../services/scheduler';
import {
  getAutoSignTime,
  getFocusHumanVerificationWindow,
  getLastCheckInTime,
  loadResults,
  loadRunState,
  setAutoSignTime,
} from '../services/storage';
import { isValidAutoSignTime } from '../shared/time';
import { cancelRun, isRunning, startBatchRun, startSingleRun } from './orchestrator';

async function buildStatus(): Promise<StatusResponse> {
  const [lastCheckInTime, checkInResults, runState, autoSignTime, focus] = await Promise.all([
    getLastCheckInTime(),
    loadResults(),
    loadRunState(),
    getAutoSignTime(),
    getFocusHumanVerificationWindow(),
  ]);
  return {
    lastCheckInTime,
    checkInResults,
    runState,
    autoSignTime,
    focusHumanVerificationWindow: focus,
  };
}

async function runningResponse(): Promise<CheckinResponse> {
  return {
    success: true,
    running: true,
    results: await loadResults(),
    runState: await loadRunState(),
  };
}

export async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'checkin/manual': {
      if (isRunning()) return runningResponse();
      const results = await startBatchRun('manual');
      return { success: true, running: false, results } satisfies CheckinResponse;
    }
    case 'checkin/retry-site': {
      if (isRunning()) return { ...(await runningResponse()), success: false, error: '已有签到任务正在执行' };
      const results = await startSingleRun(message.siteId);
      return { success: true, running: false, results } satisfies CheckinResponse;
    }
    case 'checkin/cancel': {
      const { results, runState } = await cancelRun();
      return { success: true, running: false, results, runState } satisfies CheckinResponse;
    }
    case 'status/get':
      return buildStatus();
    case 'settings/update-auto-sign-time': {
      if (!isValidAutoSignTime(message.time)) return { success: false, error: '无效的时间格式' };
      await setAutoSignTime(message.time);
      const autoSignTime = await scheduleDailyCheckIn(message.time);
      return { success: true, autoSignTime };
    }
    case 'site/activate-manual-tab': {
      const focused = await activateManualTab(message.siteId);
      return { success: focused };
    }
    case 'site/start-pick':
      return startElementPick(message.pageUrl);
    case 'event/element-picked':
      await recordPickedElement(message.selector);
      return { success: true };
    case 'event/element-pick-done':
      await finishElementPick();
      return { success: true };
    case 'event/human-verification-detected':
      return handleDetectedMessage(sender);
    default:
      return { success: false, error: 'unknown message', runState: idleRunState() };
  }
}
