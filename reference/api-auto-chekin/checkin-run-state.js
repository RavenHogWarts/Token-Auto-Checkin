(function(root) {
  function buildCheckInRunningState({ total = 0, current = 0, currentSiteId = null, source = 'manual' } = {}) {
    return {
      running: true,
      source,
      total,
      current,
      currentSiteId,
      startedAt: new Date().toISOString()
    };
  }

  function isCheckInRunningState(state) {
    return state?.running === true;
  }

  function clearCheckInRunningState(state = {}) {
    return {
      ...state,
      running: false,
      finishedAt: new Date().toISOString()
    };
  }

  function getCheckInRunState(data = {}) {
    return data.checkInRunState || { running: false };
  }

  const DEFAULT_IDLE_CHECK_IN_BUTTON_TEXT = '立即签到';
  const STALE_IDLE_CHECK_IN_BUTTON_TEXT = '今日未签，立即签到';

  function isSameLocalDate(value, now = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const referenceDate = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime()) || Number.isNaN(referenceDate.getTime())) return false;

    return date.getFullYear() === referenceDate.getFullYear() &&
      date.getMonth() === referenceDate.getMonth() &&
      date.getDate() === referenceDate.getDate();
  }

  function getIdleCheckInButtonText(lastCheckInTime, now = new Date()) {
    if (!lastCheckInTime) return DEFAULT_IDLE_CHECK_IN_BUTTON_TEXT;
    return isSameLocalDate(lastCheckInTime, now)
      ? DEFAULT_IDLE_CHECK_IN_BUTTON_TEXT
      : STALE_IDLE_CHECK_IN_BUTTON_TEXT;
  }

  function countEnabledSites(sites = []) {
    if (!Array.isArray(sites)) return 0;
    return sites.filter(site => site?.enabled !== false).length;
  }

  function canStartCheckIn(sites = [], runState = {}) {
    return countEnabledSites(sites) > 0 && !isCheckInRunningState(runState);
  }

  function canClickCheckInButton(sites = [], runState = {}) {
    return isCheckInRunningState(runState) || canStartCheckIn(sites, runState);
  }

  function markSiteChecking(results = {}, siteId) {
    if (!siteId) return { ...results };
    return {
      ...results,
      [siteId]: {
        status: 'checking',
        message: '签到中'
      }
    };
  }

  function clearResultBalances(results = {}) {
    const next = {};
    for (const [siteId, result] of Object.entries(results || {})) {
      if (!result || typeof result !== 'object') {
        next[siteId] = result;
        continue;
      }
      const { balance, ...rest } = result;
      next[siteId] = rest;
    }
    return next;
  }

  function normalizeCheckInResultsForRun(results = {}) {
    const normalized = {};
    for (const [siteId, result] of Object.entries(results)) {
      normalized[siteId] = result?.status === 'checking'
        ? { status: 'failed', message: '签到中断' }
        : result;
    }
    return normalized;
  }

  function buildCheckInCancelUpdate(data = {}, { activeRun = false, requestedAt = new Date().toISOString() } = {}) {
    const results = normalizeCheckInResultsForRun(data.checkInResults || {});
    const runState = getCheckInRunState(data);
    let nextRunState = runState;

    if (isCheckInRunningState(runState)) {
      if (activeRun) {
        nextRunState = {
          ...runState,
          cancelling: true,
          cancelRequestedAt: requestedAt
        };
      } else {
        const { cancelling, ...restRunState } = runState;
        nextRunState = {
          ...restRunState,
          running: false,
          cancelRequestedAt: requestedAt,
          finishedAt: requestedAt
        };
      }
    }

    return {
      running: isCheckInRunningState(nextRunState),
      results,
      runState: nextRunState
    };
  }

  root.buildCheckInRunningState = buildCheckInRunningState;
  root.isCheckInRunningState = isCheckInRunningState;
  root.clearCheckInRunningState = clearCheckInRunningState;
  root.getCheckInRunState = getCheckInRunState;
  root.countEnabledSites = countEnabledSites;
  root.canStartCheckIn = canStartCheckIn;
  root.canClickCheckInButton = canClickCheckInButton;
  root.markSiteChecking = markSiteChecking;
  root.clearResultBalances = clearResultBalances;
  root.normalizeCheckInResultsForRun = normalizeCheckInResultsForRun;
  root.isSameLocalDate = isSameLocalDate;
  root.getIdleCheckInButtonText = getIdleCheckInButtonText;
  root.buildCheckInCancelUpdate = buildCheckInCancelUpdate;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildCheckInRunningState,
      isCheckInRunningState,
      clearCheckInRunningState,
      getCheckInRunState,
      countEnabledSites,
      canStartCheckIn,
      canClickCheckInButton,
      markSiteChecking,
      clearResultBalances,
      normalizeCheckInResultsForRun,
      isSameLocalDate,
      getIdleCheckInButtonText,
      buildCheckInCancelUpdate
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
