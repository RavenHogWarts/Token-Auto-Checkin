// 导入配置
importScripts('schedule.js', 'config.js', 'auth-headers.js', 'checkin-result.js', 'page-automation.js', 'newapi-auth.js', 'zenapi-auth.js', 'sub2api-auth.js', 'tab-options.js', 'site-name.js', 'page-status.js', 'checkin-run-state.js', 'balance.js', 'extension-storage.js', 'human-focus-toggle.js', 'sub2api-endpoints.js');

const DAILY_CHECK_IN_ALARM = 'dailyCheckIn';
const PAGE_USABLE_TIMEOUT_MS = 20000;
const FOCUS_HUMAN_VERIFICATION_WINDOW_KEY = 'focusHumanVerificationWindow';
const AUTOMATION_HUMAN_VERIFICATION_MONITOR_MS = 120000;
const AUTOMATION_HUMAN_VERIFICATION_POLL_MS = 1000;
let currentCheckInPromise = null;
let currentCheckInCancelToken = null;
let currentCheckInContext = null;
const automationHumanVerificationMonitors = new Map();

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('公益站自动签到助手已安装');

  scheduleDailyCheckIn();
  initializeInstallStorageDefaults().catch((error) => {
    console.error('初始化签到存储失败:', error);
  });
});

async function initializeInstallStorageDefaults() {
  const existingStorage = await chrome.storage.local.get(['lastCheckInTime', 'checkInResults']);
  const defaults = buildMissingInstallStorageDefaults(existingStorage);
  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }
}

chrome.runtime.onStartup.addListener(() => {
  scheduleDailyCheckIn();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopAutomationHumanVerificationMonitor(tabId);
});

// 监听定时器
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_CHECK_IN_ALARM) {
    console.log('开始执行定时签到');
    startCheckInRun('schedule');
  }
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (isHumanVerificationDetectedMessage(request)) {
    handleHumanVerificationDetected(sender).then(sendResponse).catch(error => {
      sendResponse({ success: false, focused: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'manualCheckIn') {
    if (currentCheckInPromise) {
      chrome.storage.local.get(['checkInResults', 'checkInRunState'], (data) => {
        sendResponse({
          success: true,
          running: true,
          results: data.checkInResults || {},
          runState: getCheckInRunState(data)
        });
      });
    } else {
      startCheckInRun('manual').then(results => {
        sendResponse({ success: true, running: false, results });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    }
    return true;
  }

  if (request.action === 'retrySiteCheckIn') {
    if (currentCheckInPromise) {
      chrome.storage.local.get(['checkInResults', 'checkInRunState'], (data) => {
        sendResponse({
          success: false,
          running: true,
          results: data.checkInResults || {},
          runState: getCheckInRunState(data),
          error: '已有签到任务正在执行'
        });
      });
    } else {
      startSingleSiteCheckInRun(request.siteId).then(results => {
        sendResponse({ success: true, running: false, results });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    }
    return true;
  }

  if (request.action === 'cancelCheckIn') {
    cancelCurrentCheckInRun().then(response => {
      sendResponse(response);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'getStatus') {
    chrome.storage.local.get([
      'lastCheckInTime',
      'checkInResults',
      'checkInRunState',
      'autoSignTime',
      FOCUS_HUMAN_VERIFICATION_WINDOW_KEY
    ], (data) => {
      sendResponse({
        ...data,
        checkInRunState: getCheckInRunState(data),
        autoSignTime: isValidAutoSignTime(data.autoSignTime) ? data.autoSignTime : GLOBAL_CONFIG.autoSignTime,
        focusHumanVerificationWindow: data.focusHumanVerificationWindow === true
      });
    });
    return true;
  }

  if (request.action === 'updateAutoSignTime') {
    const time = request.time;
    if (!isValidAutoSignTime(time)) {
      sendResponse({ success: false, error: '无效的时间格式' });
      return false;
    }

    chrome.storage.local.set({ autoSignTime: time }).then(() => {
      return scheduleDailyCheckIn(time);
    }).then((autoSignTime) => {
      sendResponse({ success: true, autoSignTime });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

function startCheckInRun(source = 'manual') {
  if (currentCheckInPromise) {
    console.log('已有签到任务正在执行，跳过重复触发');
    return currentCheckInPromise;
  }

  const cancelToken = createCheckInCancelToken();
  const runContext = { cancelToken, tabSession: null };
  currentCheckInCancelToken = cancelToken;
  currentCheckInContext = runContext;
  currentCheckInPromise = executeAllCheckIns({ source, cancelToken, runContext }).finally(() => {
    if (currentCheckInCancelToken === cancelToken) currentCheckInCancelToken = null;
    if (currentCheckInContext === runContext) currentCheckInContext = null;
    currentCheckInPromise = null;
  });
  return currentCheckInPromise;
}

function startSingleSiteCheckInRun(siteId) {
  if (currentCheckInPromise) {
    console.log('已有签到任务正在执行，跳过单站重试');
    return currentCheckInPromise;
  }

  const cancelToken = createCheckInCancelToken();
  const runContext = { cancelToken, tabSession: null };
  currentCheckInCancelToken = cancelToken;
  currentCheckInContext = runContext;
  currentCheckInPromise = executeSingleSiteCheckIn(siteId, { cancelToken, runContext }).finally(() => {
    if (currentCheckInCancelToken === cancelToken) currentCheckInCancelToken = null;
    if (currentCheckInContext === runContext) currentCheckInContext = null;
    currentCheckInPromise = null;
  });
  return currentCheckInPromise;
}

function createCheckInCancelToken() {
  return {
    requested: false,
    requestedAt: null
  };
}

function isCheckInCancelRequested(cancelToken) {
  return cancelToken?.requested === true;
}

function requestCheckInCancel(cancelToken) {
  if (!cancelToken) return false;
  cancelToken.requested = true;
  cancelToken.requestedAt = cancelToken.requestedAt || new Date().toISOString();
  return true;
}

async function cancelCurrentCheckInRun() {
  if (!currentCheckInPromise || !currentCheckInCancelToken) {
    const data = await chrome.storage.local.get(['checkInResults', 'checkInRunState']);
    const cancelUpdate = buildCheckInCancelUpdate(data, {
      activeRun: false,
      requestedAt: new Date().toISOString()
    });
    await chrome.storage.local.set({
      checkInResults: cancelUpdate.results,
      checkInRunState: cancelUpdate.runState
    });

    return {
      success: true,
      running: cancelUpdate.running,
      results: cancelUpdate.results,
      runState: cancelUpdate.runState
    };
  }

  const cancelToken = currentCheckInCancelToken;
  const runContext = currentCheckInContext;
  requestCheckInCancel(cancelToken);
  await runContext?.tabSession?.close?.();

  const data = await chrome.storage.local.get(['checkInResults', 'checkInRunState']);
  const cancelUpdate = buildCheckInCancelUpdate(data, {
    activeRun: true,
    requestedAt: cancelToken.requestedAt
  });

  await chrome.storage.local.set({
    checkInResults: cancelUpdate.results,
    checkInRunState: cancelUpdate.runState
  });

  return {
    success: true,
    running: cancelUpdate.running,
    results: cancelUpdate.results,
    runState: cancelUpdate.runState
  };
}

// 执行所有站点签到
async function executeAllCheckIns({ source = 'manual', cancelToken = null, runContext = null } = {}) {
  console.log('开始批量签到');
  const results = {};
  const sites = await loadSitesConfig();
  const enabledSites = sites.filter(s => s.enabled);
  const total = enabledSites.length;
  let current = 0;
  const startedRunState = buildCheckInRunningState({ total, source });
  const { checkInResults: previousResults = {} } = await chrome.storage.local.get('checkInResults');
  await chrome.storage.local.set({
    checkInRunState: startedRunState,
    checkInResults: clearResultBalances(normalizeCheckInResultsForRun(previousResults))
  });

  // 设置初始badge
  chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
  chrome.action.setBadgeText({ text: '0/' + total });

  for (let site of sites) {
    if (isCheckInCancelRequested(cancelToken)) {
      console.log('签到任务已终止，停止处理后续站点');
      break;
    }

    if (!site.enabled) {
      console.log(`跳过禁用站点: ${site.siteName}`);
      continue;
    }

    current++;
    // 更新badge进度
    chrome.action.setBadgeText({ text: `${current}/${total}` });
    await chrome.storage.local.set({
      checkInRunState: {
        ...startedRunState,
        current,
        currentSiteId: site.siteId
      },
      checkInResults: markSiteChecking(results, site.siteId)
    });

    const tabSession = createSiteTabSession();
    if (runContext) runContext.tabSession = tabSession;
    try {
      let resolvedSite = site.mode === 'visit' ? site : await resolveSiteType(site, tabSession);
      resolvedSite = await maybeUpdateSiteName(resolvedSite, tabSession);
      if (isCheckInCancelRequested(cancelToken)) {
        results[site.siteId] = { status: 'failed', message: '签到中断' };
        break;
      }
      console.log(`开始执行: ${resolvedSite.siteName} (${resolvedSite.mode}/${resolvedSite.type})`);
      const result = resolvedSite.mode === 'visit'
        ? await visitSite(resolvedSite, tabSession)
        : await checkInSite(resolvedSite, tabSession);
      results[resolvedSite.siteId] = isCheckInCancelRequested(cancelToken)
        ? { status: 'failed', message: '签到中断' }
        : result;
      console.log(`${resolvedSite.siteName} 执行结果:`, result);
    } catch (error) {
      console.error(`${site.siteName} 执行失败:`, error);
      results[site.siteId] = isCheckInCancelRequested(cancelToken)
        ? { status: 'failed', message: '签到中断' }
        : isInvalidSiteError(error)
        ? createInvalidSiteResult(error)
        : {
          status: 'failed',
          message: error.message
        };
    } finally {
      await tabSession.close();
      if (runContext?.tabSession === tabSession) runContext.tabSession = null;
    }
    await chrome.storage.local.set({ checkInResults: results });

    if (isCheckInCancelRequested(cancelToken)) {
      console.log('签到任务已终止');
      break;
    }

    await sleep(2000);
  }

  await chrome.storage.local.set({
    lastCheckInTime: new Date().toISOString(),
    checkInResults: normalizeCheckInResultsForRun(results),
    checkInRunState: clearCheckInRunningState(startedRunState)
  });

  // 显示最终结果badge
  const successCount = Object.values(results).filter(r => r.status === 'success').length;
  const alreadyCount = Object.values(results).filter(r => r.status === 'already').length;
  const failedCount = Object.values(results).filter(r => r.status === 'failed' || r.status === 'invalid').length;

  if (failedCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    chrome.action.setBadgeText({ text: '✗' + failedCount });
  } else if (successCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    chrome.action.setBadgeText({ text: '✓' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#17a2b8' });
    chrome.action.setBadgeText({ text: '✓' });
  }

  // 5秒后清除badge
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);

  return results;
}

async function executeSingleSiteCheckIn(siteId, { cancelToken = null, runContext = null } = {}) {
  if (!siteId) throw new Error('缺少站点 ID');

  const sites = await loadSitesConfig();
  const site = sites.find(item => item.siteId === siteId);
  if (!site) throw new Error('未找到要重试的站点');
  if (!site.enabled) throw new Error('站点已禁用，请启用后重试');

  const startedRunState = buildCheckInRunningState({
    total: 1,
    current: 1,
    currentSiteId: siteId,
    source: 'retry'
  });
  const { checkInResults: previousResults = {} } = await chrome.storage.local.get('checkInResults');
  const baseResults = normalizeCheckInResultsForRun(previousResults);

  await chrome.storage.local.set({
    checkInRunState: startedRunState,
    checkInResults: markSiteChecking(baseResults, siteId)
  });

  const tabSession = createSiteTabSession();
  if (runContext) runContext.tabSession = tabSession;
  let result;
  try {
    let resolvedSite = site.mode === 'visit' ? site : await resolveSiteType(site, tabSession);
    resolvedSite = await maybeUpdateSiteName(resolvedSite, tabSession);
    if (isCheckInCancelRequested(cancelToken)) {
      result = { status: 'failed', message: '签到中断' };
    } else {
      const siteResult = resolvedSite.mode === 'visit'
        ? await visitSite(resolvedSite, tabSession)
        : await checkInSite(resolvedSite, tabSession);
      result = isCheckInCancelRequested(cancelToken)
        ? { status: 'failed', message: '签到中断' }
        : siteResult;
    }
    console.log(`${resolvedSite.siteName} 单站重试结果:`, result);
  } catch (error) {
    console.error(`${site.siteName} 单站重试失败:`, error);
    if (isCheckInCancelRequested(cancelToken)) {
      result = { status: 'failed', message: '签到中断' };
    } else if (isInvalidSiteError(error)) {
      result = createInvalidSiteResult(error);
    } else {
      result = {
        status: 'failed',
        message: error.message
      };
    }
  } finally {
    await tabSession.close();
    if (runContext?.tabSession === tabSession) runContext.tabSession = null;
  }

  const { checkInResults: latestResults = {} } = await chrome.storage.local.get('checkInResults');
  const nextResults = {
    ...normalizeCheckInResultsForRun(latestResults),
    [siteId]: result
  };

  await chrome.storage.local.set({
    checkInResults: nextResults,
    checkInRunState: clearCheckInRunningState(startedRunState),
    lastCheckInTime: new Date().toISOString()
  });

  return nextResults;
}

async function maybeUpdateSiteName(site, tabSession = null) {
  const rawSite = {
    domain: site.cookieDomain,
    name: site.siteName
  };
  if (!shouldAutoFetchSiteName(rawSite)) return site;

  const fetchedName = await fetchSiteDisplayName(site, tabSession);
  if (!fetchedName) return site;

  await updateRawSiteName(site.cookieDomain, fetchedName);
  console.log(`${site.siteName} 自动获取站点名称: ${fetchedName}`);

  return buildSiteConfig({
    domain: site.cookieDomain,
    name: fetchedName,
    enabled: site.enabled,
    mode: site.mode,
    type: site.type,
    pageUrl: site.visitUrl
  });
}

async function fetchSiteDisplayName(site, tabSession = null) {
  let tab;
  try {
    tab = await openSiteSessionTab(tabSession, site.visitUrl, 15000);
    await sleep(1000);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        ogSiteName: document.querySelector('meta[property="og:site_name"]')?.content || '',
        applicationName: document.querySelector('meta[name="application-name"]')?.content || '',
        siteName: document.querySelector('meta[name="site-name"]')?.content || ''
      })
    });

    return pickSiteDisplayName(results[0]?.result || {}, site.cookieDomain);
  } catch (e) {
    if (isInvalidSiteError(e)) throw e;
    console.warn(`${site.siteName} 获取站点名称失败:`, e);
    return null;
  } finally {
    if (!tabSession && tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

// 单个站点访问
async function visitSite(site, tabSession = null) {
  let tab;
  try {
    tab = await openSiteSessionTab(tabSession, site.visitUrl, 20000);
    await sleep(3000);

    const loginRecovery = await recoverAutomationLoginPageIfNeeded(site, tab.id, tabSession, `${site.siteName} 访问`);
    if (loginRecovery.securityCheck) {
      return { status: 'failed', message: '站点要求完成人机验证，自动访问已停止', requiresSecurityCheck: true };
    }
    if (loginRecovery.failed) {
      return { status: 'failed', message: loginRecovery.result?.message || '站点登录失败，无法读取余额' };
    }
    if (loginRecovery.recovered) {
      tab = await chrome.tabs.get(loginRecovery.tabId || tab.id);
      await navigateAutomationTabToVisitUrl(tab.id, site);
    }

    const tabInfo = await chrome.tabs.get(tab.id);
    if (isInvalidTabUrl(tabInfo.url)) {
      return { status: 'invalid', message: '站点页面失效' };
    }

    await refreshVisitPageBeforeReadingBalance(tab.id, site);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyText: document.body?.innerText || ''
      })
    });

    const page = results[0]?.result;
    if (!page || isInvalidTabUrl(page.url)) {
      return { status: 'invalid', message: '站点页面失效' };
    }

    const loaded = page.readyState === 'complete' || page.readyState === 'interactive';
    if (!loaded) {
      return { status: 'failed', message: '页面未完成加载' };
    }

    const balance = extractBalanceFromText(page.bodyText);
    const result = { status: 'success', message: '已访问' };
    if (balance) result.balance = balance;
    return result;
  } finally {
    if (!tabSession && tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

async function refreshVisitPageBeforeReadingBalance(tabId, site) {
  if (!tabId) return;
  try {
    console.log(`${site.siteName} 访问后刷新页面以读取最新余额`);
    await chrome.tabs.reload(tabId);
    await ensureTabPageReady(tabId, site.visitUrl, 20000);
    await sleep(1000);
  } catch (e) {
    console.warn(`${site.siteName} 访问后刷新页面失败，继续尝试读取余额:`, e);
  }
}

async function resolveSiteType(site, tabSession = null) {
  if (site.type !== 'auto') return site;

  const detectedType = await detectSiteType(site, tabSession);
  await updateRawSiteType(site.cookieDomain, detectedType);

  return buildSiteConfig({
    domain: site.cookieDomain,
    name: site.siteName,
    enabled: site.enabled,
    type: detectedType,
    pageUrl: getResolvedVisitUrl(site, detectedType)
  });
}

function getResolvedVisitUrl(site, type) {
  if (type === 'sub2api' && site.visitUrl.endsWith('/console/personal')) {
    return `https://${site.cookieDomain}/check-in`;
  }
  if (type === 'sub2api' && isTargetDomainLoginPage(site.visitUrl, site.cookieDomain)) {
    return `https://${site.cookieDomain}${getSub2ApiOAuthRedirect(site.visitUrl)}`;
  }
  if (type === 'zenapi' && site.visitUrl.endsWith('/console/personal')) {
    return `https://${site.cookieDomain}/user`;
  }
  return site.visitUrl;
}

async function detectSiteType(site, tabSession = null) {
  const urlHint = detectSiteTypeFromUrl(site.visitUrl);
  if (urlHint) return urlHint;

  let tab;
  try {
    tab = await openSiteSessionTab(tabSession, site.visitUrl, 15000);
    await sleep(1000);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const appConfig = window.__APP_CONFIG__ || {};
        if (
          Object.prototype.hasOwnProperty.call(appConfig, 'api_base_url') ||
          Object.prototype.hasOwnProperty.call(appConfig, 'linuxdo_oauth_enabled') ||
          location.pathname === '/check-in'
        ) {
          return 'sub2api';
        }

        try {
          const response = await fetch('/api/public/site-info', { credentials: 'include' });
          const data = await response.json();
          if (
            Object.prototype.hasOwnProperty.call(data, 'site_mode') ||
            Object.prototype.hasOwnProperty.call(data, 'registration_mode') ||
            Object.prototype.hasOwnProperty.call(data, 'linuxdo_enabled') ||
            location.pathname.startsWith('/user')
          ) {
            return 'zenapi';
          }
        } catch (e) {
          if (location.pathname.startsWith('/user')) return 'zenapi';
        }

        try {
          const response = await fetch('/api/status', { credentials: 'include' });
          const data = await response.json();
          if (data?.data?.linuxdo_client_id || data?.linuxdo_client_id) {
            return 'newapi';
          }
        } catch (e) {}

        return 'newapi';
      }
    });

    if (results[0]?.result === 'sub2api') return 'sub2api';
    if (results[0]?.result === 'zenapi') return 'zenapi';
    return 'newapi';
  } catch (e) {
    if (isInvalidSiteError(e)) throw e;
    console.warn(`${site.siteName} 自动识别站点类型失败，回退 New API:`, e);
    return 'newapi';
  } finally {
    if (!tabSession) await closeTabQuietly(tab?.id);
  }
}

function detectSiteTypeFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    const redirect = parsed.searchParams.get('redirect') || '';
    if (
      parsed.pathname === '/check-in' ||
      redirect === '/check-in' ||
      redirect.startsWith('/check-in?')
    ) {
      return 'sub2api';
    }
    if (parsed.pathname.startsWith('/user')) return 'zenapi';
  } catch (e) {}
  return null;
}

async function updateRawSiteType(domain, type) {
  const sites = await loadRawSites();
  const nextSites = sites.map(site => {
    if (site.domain !== domain) return site;
    const next = { ...site, type };
    if (type === 'sub2api' && !next.pageUrl) {
      next.pageUrl = `https://${domain}/check-in`;
    }
    if (type === 'zenapi' && !next.pageUrl) {
      next.pageUrl = `https://${domain}/user`;
    }
    return next;
  });
  await saveSitesConfig(nextSites);
}

async function updateRawSiteName(domain, name) {
  const sites = await loadRawSites();
  const nextSites = sites.map(site => {
    if (site.domain !== domain) return site;
    if (!shouldAutoFetchSiteName(site)) return site;
    return { ...site, name };
  });
  await saveSitesConfig(nextSites);
}

// 单个站点签到
async function checkInSite(site, tabSession = null) {
  if (site.type === 'sub2api') {
    return checkInSub2ApiSite(site, tabSession);
  }
  if (site.type === 'zenapi') {
    return checkInZenApiSite(site, tabSession);
  }

  // 1. 统一认证顺序：缓存 -> 浏览器已有登录态 -> linux.do OAuth
  const authResult = await getNewApiAuthHeaders(site, {}, tabSession);
  if (authResult?.securityCheck) {
    return buildHumanVerificationCheckInResult(site, authResult.tabToCleanup, tabSession);
  }
  let authHeaders = authResult?.headers;
  let tabToCleanup = authResult?.tabToCleanup || null;

  if (!authHeaders) {
    const fallback = await tryOfficialPageFallback(site, {
      success: false,
      message: '无法获取接口认证信息，尝试打开官方页面签到',
      httpStatus: 401
    }, tabToCleanup, tabSession);
    const result = await buildResultWithLatestBalance(site, fallback.execResult, null, fallback.tabToCleanup);
    await closeTabUnlessInSession(fallback.tabToCleanup, tabSession);
    return result;
  }

  // 2. 执行签到
  let execResult = await doCheckInRequest(site.signExecUrl, site.signExecMethod, site.signExecParams, authHeaders);
  let officialPageFallbackTried = false;
  console.log(`${site.siteName} 签到响应:`, execResult);

  if (execResult.requiresPageExecution) {
    ({ execResult, tabToCleanup } = await tryOfficialPageFallback(site, execResult, tabToCleanup, tabSession));
    officialPageFallbackTried = true;
  }

  // 3. 检测 Cloudflare 错误（cf_clearance 过期或被拦截）
  const isCloudflareError =
    (execResult.httpStatus === 403 && (execResult.error?.includes('Just a moment') || execResult.error?.includes('<!DOCTYPE html>'))) ||
    (execResult.error?.includes('<!DOCTYPE') && execResult.error?.includes('is not valid JSON'));

  if (isCloudflareError) {
    console.log(`${site.siteName} 检测到 Cloudflare 防护，清除缓存并重新登录...`);
    await clearCachedHeaders(site.siteId);

    const refreshedAuth = await getNewApiAuthHeaders(site, { forceRefresh: true, needsTabExecution: true }, tabSession);
    if (refreshedAuth?.headers) {
      // 标记该站点需要在标签页中执行（绕过 Cloudflare）
      refreshedAuth.headers._needsTabExecution = true;
      await cacheHeaders(site.siteId, refreshedAuth.headers);
      const retryResult = await doCheckInRequest(site.signExecUrl, site.signExecMethod, site.signExecParams, refreshedAuth.headers);
      console.log(`${site.siteName} 刷新认证后重试签到响应:`, retryResult);

      const fallback = await tryOfficialPageFallback(site, retryResult, refreshedAuth.tabToCleanup, tabSession);
      const result = await buildResultWithLatestBalance(site, fallback.execResult, refreshedAuth.headers, fallback.tabToCleanup);
      await closeTabUnlessInSession(fallback.tabToCleanup, tabSession);
      if (tabToCleanup && tabToCleanup !== fallback.tabToCleanup) await closeTabUnlessInSession(tabToCleanup, tabSession);
      return result;
    }
    await closeTabUnlessInSession(tabToCleanup, tabSession);
    throw new Error('Cloudflare 验证失败，重新登录失败');
  }

  // 4. 如果 401，重新按“浏览器已有登录态 -> OAuth”顺序获取认证
  if (execResult.httpStatus === 401) {
    console.log(`${site.siteName} 认证过期，尝试刷新浏览器登录态...`);
    await clearCachedHeaders(site.siteId);

    const refreshedAuth = await getNewApiAuthHeaders(site, { forceRefresh: true }, tabSession);
    if (refreshedAuth?.headers) {
      await cacheHeaders(site.siteId, refreshedAuth.headers);
      const retryResult = await doCheckInRequest(site.signExecUrl, site.signExecMethod, site.signExecParams, refreshedAuth.headers);
      console.log(`${site.siteName} 刷新认证后重试签到响应:`, retryResult);

      const fallback = await tryOfficialPageFallback(site, retryResult, refreshedAuth.tabToCleanup, tabSession);
      const result = await buildResultWithLatestBalance(site, fallback.execResult, refreshedAuth.headers, fallback.tabToCleanup);
      await closeTabUnlessInSession(fallback.tabToCleanup, tabSession);
      if (tabToCleanup && tabToCleanup !== fallback.tabToCleanup) await closeTabUnlessInSession(tabToCleanup, tabSession);
      return result;
    }
    const fallback = await tryOfficialPageFallback(site, {
      success: false,
      message: '接口认证已过期，刷新浏览器登录态失败，尝试打开官方页面签到',
      httpStatus: 401
    }, tabToCleanup, tabSession);
    const result = await buildResultWithLatestBalance(site, fallback.execResult, authHeaders, fallback.tabToCleanup);
    await closeTabUnlessInSession(fallback.tabToCleanup, tabSession);
    return result;
  }

  if (!officialPageFallbackTried) {
    ({ execResult, tabToCleanup } = await tryOfficialPageFallback(site, execResult, tabToCleanup, tabSession));
  }

  // 4. 查询验证
  let queryVerified = false;
  const isSuccess = execResult.success || execResult.alreadyCheckedIn;
  if (site.signQueryUrl && isSuccess) {
    await sleep(1000);
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const queryUrl = `${site.signQueryUrl}?month=${currentMonth}`;
      const queryResult = await doFetchWithHeaders(queryUrl, 'GET', null, authHeaders);
      queryVerified = queryResult.data?.data?.stats?.checked_in_today || false;
    } catch (e) {
      console.warn(`${site.siteName} 查询失败:`, e);
    }
  }

  const result = await buildResultWithLatestBalance(site, execResult, authHeaders, tabToCleanup);
  await closeTabUnlessInSession(tabToCleanup, tabSession);
  result.queryVerified = queryVerified;
  return result;
}

async function checkInSub2ApiSite(site, tabSession = null) {
  const pageResult = await checkInSub2ApiFromOfficialPage(site, tabSession);
  const execResult = pageResult.result;
  const result = await buildResultWithLatestBalance(site, execResult, null, pageResult.tabId);

  if (pageResult.keepTabOpen) {
    await focusTabWindow(pageResult.tabId);
  } else {
    await closeTabUnlessInSession(pageResult.tabId, tabSession);
  }

  result.queryVerified = execResult.success || execResult.alreadyCheckedIn || false;
  return result;
}

async function checkInSub2ApiFromOfficialPage(site, tabSession = null) {
  const prepared = await prepareSub2ApiPageFirstTab(site, tabSession);
  if (prepared.result) {
    const fallbackOptions = await getOfficialPageFallbackOptions();
    return {
      result: prepared.result,
      tabId: prepared.tabId,
      keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(prepared.result, fallbackOptions)
    };
  }

  return checkInFromOfficialPage(site, tabSession, {
    tabId: prepared.tabId,
    cleanupOrdinaryDialogs: true,
    forceRefreshBeforeBalance: true
  });
}

async function prepareSub2ApiPageFirstTab(site, tabSession = null) {
  let tab = await openSiteSessionTab(tabSession, site.visitUrl, 20000);
  let activeTabId = tab.id;
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(attempt === 0 ? 1000 : 1500);

    const securityCheckResult = await getAutomationHumanVerificationResult(activeTabId);
    if (securityCheckResult) {
      return { tabId: activeTabId, result: securityCheckResult };
    }

    let tabInfo;
    try {
      tabInfo = await chrome.tabs.get(activeTabId);
    } catch (e) {
      throw new Error('Sub2API 签到页已关闭，自动签到已停止');
    }

    if (isInvalidTabUrl(tabInfo.url)) {
      return {
        tabId: activeTabId,
        result: {
          success: false,
          invalidSite: true,
          message: '站点页面失效',
          httpStatus: 0
        }
      };
    }

    const loginState = await getAutomationLoginPageState(activeTabId, site);
    if (loginState || isSub2ApiPageFirstLoginUrl(tabInfo.url, site.cookieDomain)) {
      const oauthResult = await autoSub2ApiOAuthLogin(site.cookieDomain, activeTabId, site.visitUrl);
      activeTabId = oauthResult?.tabId || activeTabId;

      if (oauthResult?.securityCheck) {
        return { tabId: activeTabId, result: buildHumanVerificationResult() };
      }

      if (!oauthResult) {
        return {
          tabId: activeTabId,
          result: {
            success: false,
            message: 'Sub2API 登录失败，请确认浏览器已登录 linux.do 后重试',
            httpStatus: 401
          }
        };
      }

      const postLoginUrl = getSub2ApiPageFirstReturnUrl(site.cookieDomain, site.visitUrl);
      await chrome.tabs.update(activeTabId, { url: postLoginUrl, active: false });
      await ensureTabPageReady(activeTabId, postLoginUrl, 20000);
      continue;
    }

    if (tabInfo.url?.includes(site.cookieDomain)) {
      return { tabId: activeTabId };
    }
  }

  return { tabId: activeTabId };
}

async function refreshSub2ApiAuthHeaders(site, tabSession = null, baseHeaders = null) {
  let authHeaders = baseHeaders || null;
  let authTabId = null;

  const oauthResult = await autoSub2ApiOAuthLogin(site.cookieDomain, null, site.visitUrl);
  authHeaders = oauthResult?.headers || authHeaders;
  authTabId = oauthResult?.tabId || null;

  if (!hasSub2ApiUsableAuth(authHeaders)) {
    const tab = await openSiteSessionTab(tabSession, site.visitUrl);
    authTabId = tab.id;
    authHeaders = await readSub2ApiAuthHeadersFromTab(tab.id, authHeaders);
  }

  return { headers: authHeaders, tabId: authTabId };
}

async function checkInZenApiSite(site, tabSession = null) {
  let authHeaders = await getCachedHeaders(site.siteId);
  let tabToCleanup = null;

  if (!hasAuthorizationHeader(authHeaders)) {
    const tab = await openSiteSessionTab(tabSession, site.visitUrl);
    let authTabId = tab.id;
    const loginRecovery = await recoverAutomationLoginPageIfNeeded(site, tab.id, tabSession, `${site.siteName} ZenAPI 登录态`);
    if (loginRecovery.securityCheck) {
      return buildHumanVerificationCheckInResult(site, loginRecovery.tabId || tab.id, tabSession);
    }
    if (loginRecovery.recovered && loginRecovery.headers) {
      authHeaders = loginRecovery.headers;
      authTabId = loginRecovery.tabId || authTabId;
    } else if (loginRecovery.failed) {
      await closeTabUnlessInSession(loginRecovery.tabId || tab.id, tabSession);
      throw new Error('ZenAPI 登录失败，请确认浏览器已登录 linux.do 后重试');
    }

    if (!hasAuthorizationHeader(authHeaders)) {
      authHeaders = await readStorageTokenAuthHeadersFromTab(tab.id, ['user_token'], authHeaders);
    }

    if (!hasAuthorizationHeader(authHeaders)) {
      const oauthResult = await autoZenApiOAuthLogin(site.cookieDomain, tab.id);
      if (oauthResult?.securityCheck) {
        return buildHumanVerificationCheckInResult(site, oauthResult.tabId || tab.id, tabSession);
      }
      authHeaders = oauthResult?.headers || authHeaders;
      authTabId = oauthResult?.tabId || authTabId;
    }

    if (!hasAuthorizationHeader(authHeaders)) {
      await closeTabUnlessInSession(tab.id, tabSession);
      throw new Error('ZenAPI 登录失败，请确认浏览器已登录 linux.do 后重试');
    }

    await cacheHeaders(site.siteId, authHeaders);
    tabToCleanup = authTabId;
  }

  const zenApiHeaders = { ...authHeaders, _needsTabExecution: true };
  let activeHeaders = zenApiHeaders;
  let execResult = await doCheckInRequest(site.signExecUrl, site.signExecMethod, site.signExecParams, zenApiHeaders);
  console.log(`${site.siteName} ZenAPI 签到响应:`, execResult);

  if (execResult.httpStatus === 401 || execResult.httpStatus === 403) {
    await clearCachedHeaders(site.siteId);
    const tab = await openSiteSessionTab(tabSession, site.visitUrl);
    let authTabId = tab.id;
    const loginRecovery = await recoverAutomationLoginPageIfNeeded(site, tab.id, tabSession, `${site.siteName} ZenAPI 重新登录`);
    if (loginRecovery.securityCheck) {
      return buildHumanVerificationCheckInResult(site, loginRecovery.tabId || tab.id, tabSession);
    }
    if (loginRecovery.recovered && loginRecovery.headers) {
      authHeaders = loginRecovery.headers;
      authTabId = loginRecovery.tabId || authTabId;
    } else if (loginRecovery.failed) {
      await closeTabUnlessInSession(loginRecovery.tabId || tab.id, tabSession);
      throw new Error('ZenAPI 登录失败，请确认浏览器已登录 linux.do 后重试');
    }

    if (!hasAuthorizationHeader(authHeaders)) {
      authHeaders = await readStorageTokenAuthHeadersFromTab(tab.id, ['user_token'], null);
    }

    if (!hasAuthorizationHeader(authHeaders)) {
      const oauthResult = await autoZenApiOAuthLogin(site.cookieDomain, tab.id);
      if (oauthResult?.securityCheck) {
        return buildHumanVerificationCheckInResult(site, oauthResult.tabId || tab.id, tabSession);
      }
      authHeaders = oauthResult?.headers || authHeaders;
      authTabId = oauthResult?.tabId || authTabId;
    }

    if (hasAuthorizationHeader(authHeaders)) {
      const retryHeaders = { ...authHeaders, _needsTabExecution: true };
      activeHeaders = retryHeaders;
      await cacheHeaders(site.siteId, authHeaders);
      execResult = await doCheckInRequest(site.signExecUrl, site.signExecMethod, site.signExecParams, retryHeaders);
      console.log(`${site.siteName} ZenAPI 重新读取令牌后签到响应:`, execResult);
      if (tabToCleanup && tabToCleanup !== authTabId) await closeTabUnlessInSession(tabToCleanup, tabSession);
      tabToCleanup = authTabId;
    } else {
      await closeTabUnlessInSession(tab.id, tabSession);
    }
  }

  ({ execResult, tabToCleanup } = await tryOfficialPageFallback(site, execResult, tabToCleanup, tabSession));

  const result = await buildResultWithLatestBalance(site, execResult, activeHeaders, tabToCleanup);
  await closeTabUnlessInSession(tabToCleanup, tabSession);
  result.queryVerified = execResult.success || execResult.alreadyCheckedIn || false;
  return result;
}

async function tryOfficialPageFallback(site, execResult, tabToCleanup = null, tabSession = null) {
  if (!shouldTryOfficialPageCheckIn(execResult)) {
    return { execResult, tabToCleanup };
  }

  console.log(`${site.siteName} 接口签到失败，尝试打开官方页面点击签到按钮...`);
  const fallbackOptions = await getOfficialPageFallbackOptions();
  const openInForeground = shouldOpenOfficialPageFallbackInForeground(execResult, fallbackOptions);
  let pageResult;
  try {
    pageResult = await checkInFromOfficialPage(site, tabSession, { openInForeground });
  } catch (e) {
    await closeTabUnlessInSession(tabToCleanup, tabSession);
    throw e;
  }
  let nextTabToCleanup = tabToCleanup;

  if (pageResult.tabId) {
    if (pageResult.keepTabOpen) {
      if (tabToCleanup && tabToCleanup !== pageResult.tabId) {
        await closeTabUnlessInSession(tabToCleanup, tabSession);
      }
      await focusTabWindow(pageResult.tabId);
      nextTabToCleanup = null;
    } else if (nextTabToCleanup && nextTabToCleanup !== pageResult.tabId) {
      await closeTabUnlessInSession(pageResult.tabId, tabSession);
    } else {
      nextTabToCleanup = pageResult.tabId;
    }
  }

  console.log(`${site.siteName} 官方页面兜底签到响应:`, pageResult.result);
  return { execResult: pageResult.result, tabToCleanup: nextTabToCleanup };
}

async function checkInFromOfficialPage(site, tabSession = null, options = {}) {
  let tab = options.tabId
    ? await chrome.tabs.get(options.tabId)
    : await openSiteSessionTab(tabSession, site.visitUrl, 20000, {
      active: options.openInForeground === true
    });
  if (options.openInForeground === true) {
    await focusTabWindow(tab.id);
  }
  await sleep(3000);

  const fallbackOptions = await getOfficialPageFallbackOptions();
  const securityCheckResult = await getAutomationHumanVerificationResult(tab.id);
  if (securityCheckResult) {
    return {
      result: securityCheckResult,
      tabId: tab.id,
      keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(securityCheckResult, fallbackOptions)
    };
  }

  const loginRecovery = await recoverAutomationLoginPageIfNeeded(site, tab.id, tabSession, `${site.siteName} 兜底签到`);
  if (loginRecovery.securityCheck) {
    const result = buildHumanVerificationResult();
    return {
      result,
      tabId: loginRecovery.tabId || tab.id,
      keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(result, fallbackOptions)
    };
  }
  if (loginRecovery.failed) {
    return {
      result: loginRecovery.result,
      tabId: loginRecovery.tabId || tab.id,
      keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(loginRecovery.result, fallbackOptions)
    };
  }
  if (loginRecovery.recovered) {
    tab = await chrome.tabs.get(loginRecovery.tabId || tab.id);
    await navigateAutomationTabToVisitUrl(tab.id, site);
    tab = await chrome.tabs.get(tab.id);
  }

  const latestTabInfo = await chrome.tabs.get(tab.id).catch(() => tab);
  const officialPageAutomationOptions = {
    humanVerification: getHumanVerificationProbeConfig(),
    cleanupOrdinaryDialogs: options.cleanupOrdinaryDialogs === true,
    skipOrdinaryDialogCleanup: shouldSkipOrdinaryDialogCleanupForUrl(latestTabInfo?.url || site.visitUrl)
  };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (targetUrl, automationOptions) => {
      const originalFetch = window.fetch;
      const originalXhrOpen = window.XMLHttpRequest?.prototype?.open;
      const originalXhrSend = window.XMLHttpRequest?.prototype?.send;
      const checkInResponses = [];
      let targetPath = '';

      try {
        targetPath = new URL(targetUrl).pathname;
      } catch (e) {}

      function recordCheckInResponse(url, method, status, text) {
        try {
          if (!url) {
            return;
          }
          const requestMethod = String(method || 'GET').toUpperCase();
          const requestPath = new URL(String(url), location.origin).pathname;
          const commonCheckInPath =
            requestPath.includes('/checkin') ||
            requestPath.includes('/check-in') ||
            requestPath.includes('/signin') ||
            requestPath.includes('/sign-in');
          if (requestPath !== targetPath && !commonCheckInPath) return;
          if (requestMethod !== 'POST' && !commonCheckInPath) return;

          let data = null;
          try { data = JSON.parse(text); } catch (e) {}
          checkInResponses.push({ httpStatus: status, data, text, method: requestMethod, url: String(url) });
        } catch (e) {}
      }

      window.fetch = async (...args) => {
        const response = await originalFetch.apply(window, args);
        try {
          const request = args[0];
          const options = args[1] || {};
          const url = typeof request === 'string' ? request : request?.url;
          const method = String(options.method || request?.method || 'GET').toUpperCase();
          if (url) {
            const clone = response.clone();
            const text = await clone.text();
            recordCheckInResponse(url, method, response.status, text);
          }
        } catch (e) {}
        return response;
      };

      if (originalXhrOpen && originalXhrSend) {
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__newApiCheckInRequest = { method, url: String(url || '') };
          return originalXhrOpen.call(this, method, url, ...rest);
        };
        window.XMLHttpRequest.prototype.send = function(...args) {
          try {
            this.addEventListener('load', () => {
              const req = this.__newApiCheckInRequest || {};
              recordCheckInResponse(req.url, req.method, this.status, this.responseText || '');
            }, { once: true });
          } catch (e) {}
          return originalXhrSend.apply(this, args);
        };
      }

      const pollIntervalMs = 500;
      const regularWaitLoops = 40;
      const securityCheckWaitLoops = 40;
      let securityCheckNotified = false;

      function isVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0;
      }

      function hasSecurityCheck() {
        const text = document.body?.innerText || '';
        const securityOptions = automationOptions?.humanVerification || {};
        const textPattern = new RegExp(securityOptions.textPatternSource || 'Security Check|安全验证|人机验证|Turnstile|captcha|验证码|请完成验证|verify you are human', 'i');
        const selectorMatches = (securityOptions.selectors || []).filter((selector) => {
          try {
            return Boolean(document.querySelector(selector));
          } catch (e) {
            return false;
          }
        });
        const detected = textPattern.test(text) || selectorMatches.length > 0;
        if (detected) notifySecurityCheckDetected();
        return detected;
      }

      function notifySecurityCheckDetected() {
        if (securityCheckNotified) return;
        securityCheckNotified = true;
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ action: 'humanVerificationDetected' }, () => {
              void chrome.runtime?.lastError;
            });
          }
        } catch (e) {}
      }

      function isOrdinaryDialogCloseControl(text) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length > 40) return false;
        if (/Security Check|安全验证|人机验证|Turnstile|captcha|验证码|请完成验证|verify you are human|hCaptcha|reCAPTCHA|Cloudflare/i.test(normalized)) return false;
        if (/linux\s*\.?\s*do|oauth|authorize|授权|允许|登录|login|verify|验证/i.test(normalized)) return false;
        return /^(×|x|X|关闭|取消|我知道了|知道了|好的|确定|OK|Ok|ok|Close|Dismiss|Got it)$/i.test(normalized);
      }

      async function closeOrdinaryDialogs() {
        if (automationOptions?.cleanupOrdinaryDialogs !== true || automationOptions?.skipOrdinaryDialogCleanup === true) {
          return { closed: 0 };
        }
        if (hasSecurityCheck()) return { closed: 0, skipped: 'security-check' };

        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (e) {}
        await new Promise(resolve => setTimeout(resolve, 100));

        const selectors = [
          'button',
          '[role="button"]',
          'a',
          'input[type="button"]',
          'input[type="submit"]',
          '[aria-label]',
          '[title]',
          '[data-dismiss]',
          '[class*="close"]',
          '[class*="modal-close"]'
        ].join(', ');

        const candidates = Array.from(document.querySelectorAll(selectors))
          .filter((el) => isVisible(el))
          .filter((el) => !el.closest('.cf-turnstile, .g-recaptcha, .h-captcha, [data-sitekey]'))
          .map((el) => ({ el, text: getCandidateText(el) }))
          .filter(({ text }) => isOrdinaryDialogCloseControl(text))
          .slice(0, 3);

        for (const { el } of candidates) {
          try {
            el.click();
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (e) {}
        }
        return { closed: candidates.length };
      }

      function getCandidateText(el) {
        return [
          el.textContent,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.getAttribute('data-title'),
          el.getAttribute('data-tooltip'),
          el.value
        ].filter(Boolean).join(' ').trim();
      }

      function matchesAlreadyCheckedText(text) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length > 40) return false;
        return /^(Checked in|Already checked|Already signed|已签到|已签|已签过|今日已签|今日已签到|今天已签|今天已签到|已经签到)$/i.test(normalized) ||
          /^(今日|今天).{0,12}(已签到|已签|已签过|已经签到)$/i.test(normalized) ||
          /^(Checked in|Already checked|Already signed).{0,16}today$/i.test(normalized);
      }

      function findCheckedInStateText() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], [role="status"], [aria-live], a, input[type="button"], input[type="submit"], [tabindex]:not([tabindex="-1"]), [onclick], [class*="cursor-pointer"], [data-slot="button"], [class*="status"], [class*="tag"], [class*="badge"], [class*="checked"], [class*="signed"], [class*="success"], span, p'));
        const found = candidates.find((el) => {
          const text = getCandidateText(el).replace(/\s+/g, ' ').trim();
          return text &&
            isVisible(el) &&
            matchesAlreadyCheckedText(text);
        });
        return found ? getCandidateText(found).replace(/\s+/g, ' ').trim() : '';
      }

      function hasCheckedInText() {
        return Boolean(findCheckedInStateText());
      }

      function isDisabledCandidate(el) {
        return el.disabled ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('disabled') ||
          el.closest('[aria-disabled="true"], [disabled]');
      }

      function matchesCheckInText(text) {
        return /Check in now|check.?in|checkin|daily check.?in|daily reward|claim reward|领取奖励|领取额度|每日领取|签到领取|每日福利|今日福利|立即签到|现在签到|每日签到|^签$|^签到$|^领取$/i.test(text);
      }

      function isNonUserCheckInControl(text) {
        return /settings?|配置|设置|enable check.?in|minimum check.?in|maximum check.?in|check.?in quota/i.test(text);
      }

      function getCheckInTextPriority(text) {
        if (/立即签到|现在签到|Check in now|^签到$|^签$/i.test(text)) return 0;
        if (/签到领取|领取奖励|领取额度|claim reward|^领取$/i.test(text)) return 1;
        if (/每日签到|每日领取|daily check.?in|daily reward|今日福利|每日福利/i.test(text)) return 2;
        if (/check.?in|checkin/i.test(text)) return 3;
        return 4;
      }

      function isImmediateCheckInText(text) {
        return getCheckInTextPriority(text) === 0;
      }

      function findCheckInButton({ immediateOnly = false } = {}) {
        const clickableSelector = [
          'button',
          '[role="button"]',
          'a',
          'input[type="button"]',
          'input[type="submit"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]',
          '[class*="cursor-pointer"]',
          '[data-slot="button"]'
        ].join(', ');
        const directCandidates = Array.from(document.querySelectorAll(clickableSelector));
        const textCandidates = Array.from(document.querySelectorAll('button, a, div, span, p, li')).filter((el) => {
          const text = getCandidateText(el);
          return text && text.length <= 80 && matchesCheckInText(text);
        });
        const candidates = [...directCandidates, ...textCandidates]
          .map((el) => el.closest(clickableSelector) || el)
          .filter((el, index, arr) => el && arr.indexOf(el) === index);

        return candidates
          .map((el, index) => ({ el, index, text: getCandidateText(el) }))
          .filter(({ el, text }) => text &&
            text.length <= 120 &&
            !isDisabledCandidate(el) &&
            isVisible(el) &&
            matchesCheckInText(text) &&
            (!immediateOnly || isImmediateCheckInText(text)) &&
            !isNonUserCheckInControl(text) &&
            !matchesAlreadyCheckedText(text))
          .sort((a, b) => getCheckInTextPriority(a.text) - getCheckInTextPriority(b.text) || a.index - b.index)[0]?.el || null;
      }

      function getCheckInCandidateSummary() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"], [tabindex]:not([tabindex="-1"]), [onclick], [class*="cursor-pointer"], [data-slot="button"]'))
          .map(getCandidateText)
          .map(text => text.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .filter(text => text.length <= 80)
          .slice(0, 8);
        return candidates.join(' | ');
      }

      function hasDisabledCheckInButton() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"], [tabindex]:not([tabindex="-1"]), [onclick], [class*="cursor-pointer"], [data-slot="button"]'));
        return candidates.some((el) => {
          const text = getCandidateText(el);
          return text &&
            text.length <= 120 &&
            isDisabledCandidate(el) &&
            isVisible(el) &&
            matchesCheckInText(text) &&
            !isNonUserCheckInControl(text) &&
            !matchesAlreadyCheckedText(text) &&
            !/Loading|加载|处理中/i.test(text);
        });
      }

      try {
        await closeOrdinaryDialogs();

        let button = null;
        let clickedText = '';
        let securityCheckSeen = false;
        for (let i = 0; i < (securityCheckSeen ? securityCheckWaitLoops : regularWaitLoops); i++) {
          button = findCheckInButton({ immediateOnly: true });
          if (button) break;

          const checkedInStateText = findCheckedInStateText();
          if (checkedInStateText) {
            return { kind: 'already', message: `今日已签到: ${checkedInStateText}` };
          }
          if (hasDisabledCheckInButton()) {
            return { kind: 'already', message: '今日已签到' };
          }
          button = findCheckInButton();
          if (button) break;
          if (hasSecurityCheck()) {
            securityCheckSeen = true;
          }
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        if (!button) {
          const candidates = getCheckInCandidateSummary();
          return {
            kind: hasSecurityCheck() ? 'security-check' : 'no-button',
            message: hasSecurityCheck()
              ? '站点要求完成人机验证，等待超时，自动签到已停止'
              : candidates
                ? `未找到官方页面签到按钮，页面候选: ${candidates}`
                : '未找到官方页面签到按钮，自动签到失败',
            candidates
          };
        }

        button.scrollIntoView?.({ block: 'center', inline: 'center' });
        await new Promise(resolve => setTimeout(resolve, 100));
        clickedText = getCandidateText(button).replace(/\s+/g, ' ').trim().slice(0, 80);
        button.click();

        for (let i = 0; i < (securityCheckSeen ? securityCheckWaitLoops : regularWaitLoops); i++) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          if (checkInResponses.length > 0) {
            return { kind: 'response', clickedText, ...checkInResponses[checkInResponses.length - 1] };
          }
          if (hasSecurityCheck()) {
            securityCheckSeen = true;
            continue;
          }
          if (hasCheckedInText()) {
            return {
              kind: 'success',
              message: '签到成功',
              data: { clickedText }
            };
          }
        }

        return {
          kind: securityCheckSeen ? 'security-check' : 'timeout',
          message: securityCheckSeen
            ? '站点要求完成人机验证，等待超时，自动签到已停止'
            : clickedText
            ? `官方页面已点击「${clickedText}」，但未捕获到签到结果`
            : '官方页面签到请求超时，自动签到失败',
          clickedText,
          candidates: getCheckInCandidateSummary()
        };
      } finally {
        window.fetch = originalFetch;
        if (originalXhrOpen && originalXhrSend) {
          window.XMLHttpRequest.prototype.open = originalXhrOpen;
          window.XMLHttpRequest.prototype.send = originalXhrSend;
        }
      }
    },
    args: [site.signExecUrl, officialPageAutomationOptions]
  });

  const pageResult = results[0]?.result || {};
  if (shouldRefreshBalanceAfterPageResult(pageResult, { forceRefresh: options.forceRefreshBeforeBalance === true })) {
    await refreshTabBeforeReadingBalance(tab.id, site);
  }
  const fallbackPageBalance = await readBalanceFromTab(tab.id, site);
  console.log(`${site.siteName} 官方页面签到执行结果:`, pageResult);

  function withFallbackPageBalance(result) {
    if (fallbackPageBalance) result.balance = fallbackPageBalance;
    return result;
  }

  if (pageResult.kind === 'response' && pageResult.data) {
    let parsed = parseCheckInResponse(pageResult.data, pageResult.httpStatus, false);
    if (parsed.alreadyCheckedIn && pageResult.clickedText) {
      parsed = markOfficialPageClickSuccess(parsed, pageResult.clickedText);
    }
    if (parsed.requiresPageExecution) {
      parsed.message = '站点仍要求页面内操作，自动签到已停止';
      return { result: withFallbackPageBalance(parsed), tabId: tab.id, keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(parsed, fallbackOptions) };
    }
    if (parsed.requiresSecurityCheck) {
      parsed.message = '站点要求完成 Turnstile 安全验证，自动签到已停止';
      return { result: withFallbackPageBalance(parsed), tabId: tab.id, keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(parsed, fallbackOptions) };
    }
    return { result: withFallbackPageBalance(parsed), tabId: tab.id, keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(parsed, fallbackOptions) };
  }

  if (pageResult.kind === 'already') {
    return {
      result: withFallbackPageBalance({
        success: true,
        alreadyCheckedIn: true,
        message: pageResult.message || '今日已签到',
        httpStatus: 200,
        data: pageResult
      }),
      tabId: tab.id,
      keepTabOpen: false
    };
  }

  if (pageResult.kind === 'success') {
    return {
      result: withFallbackPageBalance({
        success: true,
        alreadyCheckedIn: false,
        message: pageResult.message || '签到成功',
        httpStatus: 200,
        data: pageResult,
        fallbackClicked: true
      }),
      tabId: tab.id,
      keepTabOpen: false
    };
  }

  return {
    result: withFallbackPageBalance({
      success: false,
      message: pageResult.message || getOfficialPageFallbackFailureMessage(pageResult),
      httpStatus: pageResult.kind === 'security-check' ? 403 : 0,
      data: pageResult
    }),
    tabId: tab.id,
    keepTabOpen: shouldKeepOfficialPageFallbackTabOpen(pageResult, fallbackOptions)
  };
}

async function getOfficialPageFallbackOptions() {
  const data = await chrome.storage.local.get(FOCUS_HUMAN_VERIFICATION_WINDOW_KEY);
  return {
    focusHumanVerificationWindow: getHumanFocusToggleState(data)
  };
}

async function handleHumanVerificationDetected(sender = {}) {
  const tabId = sender?.tab?.id;
  if (!tabId) {
    return { success: false, focused: false, error: 'missing tab id' };
  }

  const fallbackOptions = await getOfficialPageFallbackOptions();
  if (!fallbackOptions.focusHumanVerificationWindow) {
    return { success: true, focused: false };
  }

  await focusTabWindow(tabId);
  return { success: true, focused: true };
}

async function focusTabWindow(tabId) {
  if (!tabId) return;

  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    const windowId = tab?.windowId;
    if (windowId !== undefined && chrome.windows?.update) {
      await chrome.windows.update(windowId, { focused: true });
    }
  } catch (e) {
    console.warn('人机验证窗口前置失败:', e);
  }
}

function getAutomationTargetDomainFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === 'linux.do' || hostname.endsWith('.linux.do')) return null;
    return hostname;
  } catch (e) {
    return null;
  }
}

function getAutomationMonitorOptions(options = {}) {
  const site = options.site || null;
  return {
    targetDomain: options.targetDomain || options.domain || site?.cookieDomain || getAutomationTargetDomainFromUrl(options.url),
    siteType: options.siteType || site?.type || null,
    siteId: options.siteId || site?.siteId || null
  };
}

function recordAutomationLoginPageState(tabId, page = {}) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  if (!monitor) return null;

  const targetDomain = monitor.targetDomain || getAutomationTargetDomainFromUrl(page.url);
  if (targetDomain && !monitor.targetDomain) {
    monitor.targetDomain = targetDomain;
  }

  if (!targetDomain || !isTargetSiteLoginPage(page.url || '', targetDomain)) {
    monitor.latestLoginPage = null;
    return null;
  }

  monitor.latestLoginPage = {
    url: page.url || '',
    title: page.title || '',
    targetDomain,
    siteType: monitor.siteType || null,
    detectedAt: Date.now()
  };
  return monitor.latestLoginPage;
}

function getStoredAutomationLoginPageState(tabId, site = null) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  const state = monitor?.latestLoginPage || null;
  if (!state) return null;
  if (site?.cookieDomain && state.targetDomain !== site.cookieDomain) return null;
  return state;
}

async function getAutomationLoginPageState(tabId, site = null) {
  if (!tabId) return null;
  await probeAutomationTabHumanVerification(tabId);
  const storedState = getStoredAutomationLoginPageState(tabId, site);
  if (storedState) return storedState;

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    const domain = site?.cookieDomain || getAutomationTargetDomainFromUrl(tabInfo.url);
    if (domain && isTargetSiteLoginPage(tabInfo.url || '', domain)) {
      return recordAutomationLoginPageState(tabId, {
        url: tabInfo.url || '',
        title: tabInfo.title || ''
      });
    }
  } catch (e) {}

  return null;
}

function buildLoginRecoveryFailureResult(site, message) {
  return {
    success: false,
    message: message || `${site?.siteName || '站点'} 登录失败，请确认浏览器已登录 linux.do 后重试`,
    httpStatus: 401,
    data: { kind: 'login-required' }
  };
}

async function navigateAutomationTabToVisitUrl(tabId, site) {
  if (!tabId || !site?.visitUrl) return;
  await chrome.tabs.update(tabId, { url: site.visitUrl, active: false });
  await ensureTabPageReady(tabId, site.visitUrl, 20000);
  await sleep(1000);
}

async function recoverAutomationLoginPageIfNeeded(site, tabId, tabSession = null, logLabel = 'OAuth') {
  const loginState = await getAutomationLoginPageState(tabId, site);
  if (!loginState) return { loginPage: false, tabId };

  console.log(`[${logLabel}] 检测到目标站登录页: ${loginState.url}`);
  const siteType = site?.type || 'newapi';

  if (siteType === 'sub2api') {
    const oauthResult = await autoSub2ApiOAuthLogin(site.cookieDomain, tabId, site.visitUrl);
    if (oauthResult?.securityCheck) return { loginPage: true, securityCheck: true, tabId: oauthResult.tabId || tabId };
    if (!oauthResult) {
      return {
        loginPage: true,
        failed: true,
        tabId,
        result: buildLoginRecoveryFailureResult(site, 'Sub2API 登录失败，请确认浏览器已登录 linux.do 后重试')
      };
    }
    return { loginPage: true, recovered: true, tabId: oauthResult.tabId || tabId, headers: oauthResult.headers || null };
  }

  if (siteType === 'zenapi') {
    const oauthResult = await autoZenApiOAuthLogin(site.cookieDomain, tabId);
    if (oauthResult?.securityCheck) return { loginPage: true, securityCheck: true, tabId: oauthResult.tabId || tabId };
    if (!oauthResult?.headers) {
      return {
        loginPage: true,
        failed: true,
        tabId,
        result: buildLoginRecoveryFailureResult(site, 'ZenAPI 登录失败，请确认浏览器已登录 linux.do 后重试')
      };
    }
    return { loginPage: true, recovered: true, tabId: oauthResult.tabId || tabId, headers: oauthResult.headers };
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const oauthResult = await tryNewApiSiteLoginOAuth(site.cookieDomain, site.visitUrl, tab, tabSession);
  if (oauthResult?.securityCheck) return { loginPage: true, securityCheck: true, tabId: oauthResult.tabId || tabId };
  if (!oauthResult?.headers) {
    return {
      loginPage: true,
      failed: true,
      tabId,
      result: buildLoginRecoveryFailureResult(site, 'NewAPI 登录失败，请确认浏览器已登录 linux.do 后重试')
    };
  }
  return { loginPage: true, recovered: true, tabId: oauthResult.tabId || tabId, headers: oauthResult.headers };
}

function startAutomationHumanVerificationMonitor(tabId, options = {}) {
  if (!tabId) return null;
  const now = Date.now();
  const monitorOptions = getAutomationMonitorOptions(options);
  const existing = automationHumanVerificationMonitors.get(tabId);
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt, now + (options.durationMs || AUTOMATION_HUMAN_VERIFICATION_MONITOR_MS));
    if (monitorOptions.targetDomain) existing.targetDomain = monitorOptions.targetDomain;
    if (monitorOptions.siteType) existing.siteType = monitorOptions.siteType;
    if (monitorOptions.siteId) existing.siteId = monitorOptions.siteId;
    return existing;
  }

  const monitor = {
    tabId,
    label: options.label || 'automation',
    targetDomain: monitorOptions.targetDomain || null,
    siteType: monitorOptions.siteType || null,
    siteId: monitorOptions.siteId || null,
    startedAt: now,
    expiresAt: now + (options.durationMs || AUTOMATION_HUMAN_VERIFICATION_MONITOR_MS),
    lastNotification: null,
    latestDetection: null,
    latestLoginPage: null,
    polling: false,
    timerId: null
  };

  monitor.timerId = setInterval(() => {
    pollAutomationHumanVerificationMonitor(tabId).catch((error) => {
      console.warn('自动化标签页人机检测失败:', error);
    });
  }, options.pollMs || AUTOMATION_HUMAN_VERIFICATION_POLL_MS);

  automationHumanVerificationMonitors.set(tabId, monitor);
  pollAutomationHumanVerificationMonitor(tabId).catch(() => {});
  return monitor;
}

function stopAutomationHumanVerificationMonitor(tabId) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  if (!monitor) return;
  if (monitor.timerId) clearInterval(monitor.timerId);
  automationHumanVerificationMonitors.delete(tabId);
}

async function pollAutomationHumanVerificationMonitor(tabId) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  if (!monitor) return null;
  if (Date.now() > monitor.expiresAt) {
    stopAutomationHumanVerificationMonitor(tabId);
    return null;
  }
  if (monitor.polling) return monitor.latestDetection;

  monitor.polling = true;
  try {
    return await probeAutomationTabHumanVerification(tabId);
  } finally {
    monitor.polling = false;
  }
}

async function probeAutomationTabHumanVerification(tabId) {
  if (!tabId) return null;
  let tabInfo;
  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (e) {
    stopAutomationHumanVerificationMonitor(tabId);
    return null;
  }

  if (isInvalidTabUrl(tabInfo.url)) return null;
  recordAutomationLoginPageState(tabId, {
    url: tabInfo.url || '',
    title: tabInfo.title || ''
  });

  try {
    const probeConfig = getHumanVerificationProbeConfig();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (config) => {
        const text = document.body?.innerText || '';
        const selectorMatches = [];
        for (const selector of config.selectors || []) {
          try {
            if (document.querySelector(selector)) selectorMatches.push(selector);
          } catch (e) {}
        }
        const detected = new RegExp(config.textPatternSource, 'i').test(text) || selectorMatches.length > 0;
        return {
          detected,
          url: location.href,
          title: document.title,
          selectorMatches,
          textSample: text.replace(/\s+/g, ' ').trim().slice(0, 200)
        };
      },
      args: [probeConfig]
    });

    const page = results[0]?.result;
    recordAutomationLoginPageState(tabId, page || {});
    if (!page?.detected) return null;

    await recordAutomationHumanVerificationDetection(tabId, page);
    return page;
  } catch (e) {
    return null;
  }
}

async function recordAutomationHumanVerificationDetection(tabId, page = {}) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  const now = Date.now();
  const url = page.url || '';
  const reason = 'security-check';

  if (!monitor || shouldNotifyHumanVerification({
    tabId,
    url,
    reason,
    now,
    lastNotification: monitor.lastNotification
  })) {
    if (monitor) {
      monitor.lastNotification = {
        key: buildHumanVerificationNotificationKey(tabId, url, reason),
        notifiedAt: now
      };
    }
    await handleHumanVerificationDetected({ tab: { id: tabId } });
  }

  if (monitor) {
    monitor.latestDetection = {
      ...page,
      detectedAt: now
    };
  }
}

async function getAutomationHumanVerificationResult(tabId) {
  const monitor = automationHumanVerificationMonitors.get(tabId);
  if (monitor?.latestDetection) {
    return buildHumanVerificationResult();
  }
  const detected = await probeAutomationTabHumanVerification(tabId);
  return detected ? buildHumanVerificationResult() : null;
}

function shouldRefreshOfficialPageBeforeBalance(pageResult = {}) {
  return shouldRefreshBalanceAfterPageResult(pageResult);
}

async function refreshTabBeforeReadingBalance(tabId, site) {
  if (!tabId) return;
  try {
    console.log(`${site.siteName} 兜底签到后刷新页面以读取最新余额`);
    await chrome.tabs.reload(tabId);
    await ensureTabPageReady(tabId, site.visitUrl, 20000);
    await sleep(1000);
  } catch (e) {
    console.warn(`${site.siteName} 兜底签到后刷新页面失败，继续尝试读取余额:`, e);
  }
}

async function autoZenApiOAuthLogin(domain, tabId = null) {
  console.log(`[ZenAPI OAuth] 开始登录: ${domain}`);

  const ldCookies = await chrome.cookies.getAll({ domain: 'linux.do' });
  if (ldCookies.length === 0) {
    console.warn('[ZenAPI OAuth] linux.do 未登录');
    return null;
  }

  let tab;
  const ownsTab = !tabId;
  try {
    const postLoginUrl = getZenApiPostLoginUrl(domain);
    tab = tabId ? await chrome.tabs.get(tabId) : await createTemporaryBackgroundTab(`https://${domain}/login`);
    await chrome.tabs.update(tab.id, { url: buildZenApiLoginUrl(domain) });
    await ensureTabPageReady(tab.id, buildZenApiLoginUrl(domain), 20000);
    await sleep(1000);

    let tabInfo = await chrome.tabs.get(tab.id);
    console.log(`[ZenAPI OAuth] 当前页面: ${tabInfo.url}`);

    if (isZenApiTargetLoginPage(tabInfo.url, domain)) {
      const started = await startSiteLinuxDoOAuthFromLoginPage(
        tab.id,
        domain,
        postLoginUrl,
        'ZenAPI OAuth'
      );
      if (started?.securityCheck) {
        return { securityCheck: true, tabId: started.tabId || tab.id };
      }
      if (!started?.tabId) {
        if (ownsTab) await closeTabQuietly(tab.id);
        return null;
      }
      tab = await chrome.tabs.get(started.tabId);
      tabInfo = tab;
      console.log(`[ZenAPI OAuth] 登录页 OAuth 后页面: ${tabInfo.url}`);
    }

    if (tabInfo.url && tabInfo.url.includes('connect.linux.do')) {
      const securityCheckResult = await getAutomationHumanVerificationResult(tab.id);
      if (securityCheckResult) {
        return { securityCheck: true, tabId: tab.id };
      }
      await clickLinuxDoAuthorizeButton(tab.id);
      const redirected = await waitForTabUrlMatch(tab.id, domain, 30000);
      if (!redirected) {
        console.warn('[ZenAPI OAuth] 等待回跳 ZenAPI 超时');
        if (ownsTab) await closeTabQuietly(tab.id);
        return null;
      }
      await ensureTabPageReady(tab.id, postLoginUrl, 20000);
      await sleep(1000);
      tabInfo = await chrome.tabs.get(tab.id);
    }

    const callbackToken = extractZenApiLinuxDoToken(tabInfo.url || '');
    if (callbackToken) {
      console.log('[ZenAPI OAuth] 从回调 URL 读取到 linuxdo_token');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (token) => {
          localStorage.setItem('user_token', token);
          history.replaceState(null, '', '/user');
        },
        args: [callbackToken]
      });
    }

    await sleep(1000);
    const headers = await readStorageTokenAuthHeadersFromTab(tab.id, ['user_token'], null, 'ZenAPI');
    if (!hasAuthorizationHeader(headers) && callbackToken) {
      const fallbackHeaders = mergeZenApiTokenHeader({}, callbackToken);
      fallbackHeaders._tabId = tab.id;
      return { headers: fallbackHeaders, tabId: tab.id };
    }

    if (!hasAuthorizationHeader(headers)) {
      console.warn('[ZenAPI OAuth] 未能读取 user_token');
      if (ownsTab) await closeTabQuietly(tab.id);
      return null;
    }

    return { headers, tabId: tab.id };
  } catch (e) {
    console.warn('[ZenAPI OAuth] 登录失败:', e);
    if (ownsTab) await closeTabQuietly(tab?.id);
    return null;
  }
}

function isTargetDomainLoginPage(url, domain) {
  return isTargetSiteLoginPage(url, domain);
}

function getTargetSiteLoginCandidateUrls(domain) {
  return ['/login', '/sign-in', '/signin'].map(path => `https://${domain}${path}`);
}

async function navigateToTargetSiteLoginPage(tabId, domain, startIndex = 0, timeout = 20000) {
  const candidates = getTargetSiteLoginCandidateUrls(domain);
  let latestTabInfo = null;

  for (let offset = 0; offset < candidates.length; offset++) {
    const index = (startIndex + offset) % candidates.length;
    const loginUrl = candidates[index];
    await chrome.tabs.update(tabId, { url: loginUrl, active: false });
    await ensureTabPageReady(tabId, loginUrl, timeout);
    await sleep(1000);
    latestTabInfo = await chrome.tabs.get(tabId);
    if (isTargetDomainLoginPage(latestTabInfo.url, domain)) {
      return { tabInfo: latestTabInfo, nextIndex: index + 1 };
    }
  }

  return { tabInfo: latestTabInfo, nextIndex: startIndex + candidates.length };
}

function hasSub2ApiUsableAuth(headers) {
  return hasAuthorizationHeader(headers) || Boolean(headers?._sub2ApiSessionAuth && headers?._tabId);
}

async function autoSub2ApiOAuthLogin(domain, tabId = null, visitUrl = null) {
  console.log(`[Sub2API OAuth] 开始登录: ${domain}`);

  const ldCookies = await chrome.cookies.getAll({ domain: 'linux.do' });
  if (ldCookies.length === 0) {
    console.warn('[Sub2API OAuth] linux.do 未登录');
    return null;
  }

  let tab;
  const ownsTab = !tabId;
  const startUrl = buildSub2ApiLinuxDoOAuthStartUrl(domain, visitUrl);
  try {
    const postLoginUrl = getSub2ApiPostLoginUrl(domain, visitUrl);
    tab = tabId ? await chrome.tabs.get(tabId) : await createTemporaryBackgroundTab(startUrl);
    console.log(`[Sub2API OAuth] 打开 OAuth start 入口: ${startUrl}`);
    await chrome.tabs.update(tab.id, { url: startUrl, active: false });

    await waitForTabComplete(tab.id, 20000);
    await waitForUsableTabPage(tab.id, 20000);
    let tabInfo = await chrome.tabs.get(tab.id);
    console.log(`[Sub2API OAuth] OAuth start 后页面: ${tabInfo.url}`);

    if (isSub2ApiTargetLoginPage(tabInfo.url, domain)) {
      const started = await startSiteLinuxDoOAuthFromLoginPage(
        tab.id,
        domain,
        postLoginUrl,
        'Sub2API OAuth'
      );
      if (started?.securityCheck) {
        return { securityCheck: true, tabId: started.tabId || tab.id };
      }
      if (!started?.tabId) {
        if (ownsTab) await closeTabQuietly(tab.id);
        return null;
      }
      tab = await chrome.tabs.get(started.tabId);
      tabInfo = tab;
      console.log(`[Sub2API OAuth] 登录页 OAuth 后页面: ${tabInfo.url}`);
    }

    if (tabInfo.url && tabInfo.url.includes('connect.linux.do')) {
      const securityCheckResult = await getAutomationHumanVerificationResult(tab.id);
      if (securityCheckResult) {
        return { securityCheck: true, tabId: tab.id };
      }
      await clickLinuxDoAuthorizeButton(tab.id);
      const redirected = await waitForTabUrlMatch(tab.id, domain, 30000);
      if (!redirected) {
        console.warn('[Sub2API OAuth] 等待回跳 Sub2API 超时');
        if (ownsTab) await closeTabQuietly(tab.id);
        return null;
      }
      await ensureTabPageReady(tab.id, postLoginUrl, 20000);
      await sleep(1000);
      tabInfo = await chrome.tabs.get(tab.id);
    }

    for (let retry = 0; retry < 10; retry++) {
      const headers = await readSub2ApiAuthHeadersFromTab(tab.id, null);
      if (hasAuthorizationHeader(headers)) {
        console.log('[Sub2API OAuth] 已读取 Sub2API 登录令牌');
        return { headers, tabId: tab.id };
      }
      await sleep(1000);
    }

    tabInfo = await chrome.tabs.get(tab.id);
    if (tabInfo.url?.includes(domain) && !isSub2ApiTargetLoginPage(tabInfo.url, domain)) {
      console.log('[Sub2API OAuth] 未读取到 auth_token，改用当前标签页 session 签到');
      return { headers: { _tabId: tab.id, _sub2ApiSessionAuth: true }, tabId: tab.id };
    }

    console.warn('[Sub2API OAuth] 未能读取 auth_token');
    if (ownsTab) await closeTabQuietly(tab.id);
    return null;
  } catch (e) {
    console.warn('[Sub2API OAuth] 登录失败:', e);
    if (ownsTab) await closeTabQuietly(tab?.id);
    return null;
  }
}

async function clickSiteLinuxDoLoginButton(tabId, logLabel = 'OAuth', domain = null) {
  try {
    const tabInfo = domain ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const agreementConfig = tabInfo?.url && shouldUseLoginAgreementHelperForUrl(tabInfo.url, domain)
      ? getLoginAgreementProbeConfig()
      : null;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (agreementConfig) => {
        const loginPattern = /linux\s*\.?\s*do|linuxdo|linux\s*do|使用.*linux|linux.*登录|登录.*linux/i;
        const selectors = [
          'a[href]',
          'button',
          '[role="button"]',
          'input[type="button"]',
          'input[type="submit"]',
          '[onclick]',
          '[class*="cursor-pointer"]'
        ];

        function isVisible(el) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function collectText(el) {
          const attrs = [];
          for (const attr of Array.from(el.attributes || [])) {
            attrs.push(`${attr.name}=${attr.value}`);
          }
          const childAttrs = Array.from(el.querySelectorAll('*')).flatMap((child) => {
            return Array.from(child.attributes || []).map((attr) => `${attr.name}=${attr.value}`);
          });
          return [
            el.textContent,
            el.value,
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('href'),
            ...attrs,
            ...childAttrs
          ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        }

        function isInsideSkippedArea(el, skipSelectors) {
          for (const selector of skipSelectors || []) {
            try {
              if (el.closest(selector)) return true;
            } catch (e) {}
          }
          return false;
        }

        function isLoginAgreementText(text, config) {
          const normalized = String(text || '').replace(/\s+/g, ' ').trim();
          if (!normalized || normalized.length > 260) return false;
          const securityPattern = new RegExp(config?.humanVerificationTextPatternSource || 'Security Check|安全验证|人机验证|Turnstile|captcha|验证码|请完成验证|verify you are human', 'i');
          if (securityPattern.test(normalized)) return false;
          const negativePattern = new RegExp(config?.negativePatternSource || '记住|订阅|remember|newsletter|subscribe', 'i');
          if (negativePattern.test(normalized)) return false;
          const agreementPattern = new RegExp(config?.agreementPatternSource || '同意|协议|条款|政策|隐私|agree|terms|privacy|policy', 'i');
          return agreementPattern.test(normalized);
        }

        function getCheckboxLabel(checkbox) {
          const wrappingLabel = checkbox.closest('label');
          if (wrappingLabel) return wrappingLabel;

          const labelledBy = checkbox.getAttribute('aria-labelledby');
          if (labelledBy) {
            const label = labelledBy.split(/\s+/)
              .map(id => document.getElementById(id))
              .find(Boolean);
            if (label) return label;
          }

          const checkboxId = checkbox.getAttribute('id');
          if (checkboxId) {
            const label = Array.from(document.querySelectorAll('label[for]'))
              .find(candidate => candidate.getAttribute('for') === checkboxId);
            if (label) return label;
          }

          return checkbox.parentElement;
        }

        function collectAgreementText(checkbox) {
          const label = getCheckboxLabel(checkbox);
          const nearby = [
            label,
            checkbox.parentElement,
            checkbox.previousElementSibling,
            checkbox.nextElementSibling
          ].filter(Boolean);
          return nearby.map(collectText).join(' ').replace(/\s+/g, ' ').trim();
        }

        function isAgreementControlChecked(control) {
          if (control.matches?.('input[type="checkbox"]')) return Boolean(control.checked);
          return control.getAttribute('aria-checked') === 'true' ||
            control.getAttribute('data-state') === 'checked' ||
            control.hasAttribute('data-checked');
        }

        function isAgreementControlDisabled(control) {
          return Boolean(control.disabled) ||
            control.getAttribute('aria-disabled') === 'true' ||
            control.hasAttribute('data-disabled') ||
            Boolean(control.closest('[disabled], [aria-disabled="true"], [data-disabled]'));
        }

        function selectLoginAgreementCheckboxes(config) {
          if (!config) return { selected: 0 };
          const selectors = config.controlSelectors || ['input[type="checkbox"]'];
          const checkboxes = Array.from(new Set(Array.from(document.querySelectorAll(selectors.join(',')))));
          let selected = 0;
          for (const checkbox of checkboxes) {
            if (isAgreementControlChecked(checkbox) || isAgreementControlDisabled(checkbox) || !isVisible(checkbox)) continue;
            if (isInsideSkippedArea(checkbox, config.skipSelectors || [])) continue;
            const text = collectAgreementText(checkbox);
            if (isLoginAgreementText(text, config)) {
              checkbox.click();
              selected++;
            }
          }
          return { selected };
        }

        const agreementResult = selectLoginAgreementCheckboxes(agreementConfig);
        const candidates = Array.from(document.querySelectorAll(selectors.join(',')));

        for (const el of candidates) {
          if (!isVisible(el)) continue;
          if (el.disabled ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.closest('[disabled], [aria-disabled="true"]')) {
            continue;
          }
          const text = collectText(el);

          if (loginPattern.test(text)) {
            el.click();
            return { clicked: true, text: text.slice(0, 100), agreementSelected: agreementResult.selected };
          }
        }

        return { clicked: false, text: 'no linux.do login entry found', agreementSelected: agreementResult.selected };
      },
      args: [agreementConfig]
    });
    const result = results[0]?.result;
    console.log(`[${logLabel}] 站点登录页点击结果:`, result?.text || result);
    return Boolean(result?.clicked);
  } catch (e) {
    console.warn(`[${logLabel}] 点击站点 Linux.do 登录入口失败:`, e);
    return false;
  }
}

async function getOpenTabIds() {
  try {
    const tabs = await chrome.tabs.query({});
    return new Set(tabs.map(tab => tab.id).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

async function waitForNewLinuxDoTab(knownTabIds, timeout = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(candidate => {
        const url = candidate.url || candidate.pendingUrl || '';
        return candidate.id &&
          !knownTabIds.has(candidate.id) &&
          url.includes('connect.linux.do');
      });
      if (tab?.id) return tab;
    } catch (e) {
      return null;
    }
    await sleep(500);
  }
  return null;
}

async function startSiteLinuxDoOAuthFromLoginPage(tabId, domain, readyUrl, logLabel = 'OAuth') {
  const knownTabIds = await getOpenTabIds();
  const startedAt = Date.now();
  let activeTabId = tabId;
  let lastUrl = '';
  let loginRouteAttempt = 0;

  while (Date.now() - startedAt < 20000) {
    let tabInfo;
    try {
      tabInfo = await chrome.tabs.get(activeTabId);
      lastUrl = tabInfo.url || lastUrl;
    } catch (e) {
      return null;
    }

    const securityCheckResult = await getAutomationHumanVerificationResult(activeTabId);
    if (securityCheckResult) {
      return { tabId: activeTabId, securityCheck: true };
    }

    if (lastUrl.includes('connect.linux.do')) {
      await clickLinuxDoAuthorizeButton(activeTabId);
      const redirected = await waitForTabUrlMatch(activeTabId, domain, 30000);
      if (!redirected) {
        console.warn(`[${logLabel}] 等待回跳目标站点超时`);
        return null;
      }
      await ensureTabPageReady(activeTabId, readyUrl || `https://${domain}/`, 20000);
      await sleep(1000);
      return { tabId: activeTabId };
    }

    if (lastUrl.includes(domain) && !isTargetDomainLoginPage(lastUrl, domain)) {
      return { tabId: activeTabId };
    }

    if (!isTargetDomainLoginPage(lastUrl, domain)) {
      const navigated = await navigateToTargetSiteLoginPage(activeTabId, domain, loginRouteAttempt, 20000);
      loginRouteAttempt = navigated.nextIndex;
      lastUrl = navigated.tabInfo?.url || lastUrl;
      continue;
    }

    const clicked = await clickSiteLinuxDoLoginButton(activeTabId, logLabel, domain);
    if (!clicked) {
      await sleep(500);
      continue;
    }

    await sleep(1000);
    const newLinuxDoTab = await waitForNewLinuxDoTab(knownTabIds, 3000);
    if (newLinuxDoTab?.id) {
      startAutomationHumanVerificationMonitor(newLinuxDoTab.id, {
        label: 'linuxdo-oauth-tab',
        targetDomain: domain
      });
      if (newLinuxDoTab.active) {
        await chrome.tabs.update(newLinuxDoTab.id, { active: false }).catch(() => {});
      }
      if (activeTabId !== newLinuxDoTab.id) {
        await closeTabQuietly(activeTabId);
      }
      activeTabId = newLinuxDoTab.id;
      continue;
    }

    await waitForTabUrlChange(activeTabId, lastUrl, 10000);
    await waitForTabComplete(activeTabId, 20000);
    await waitForUsableTabPage(activeTabId, 20000);
  }

  console.warn(`[${logLabel}] 未能从登录页启动 linux.do OAuth`);
  return null;
}

async function processNewApiOAuthCallback(tabId, logLabel = 'OAuth') {
  let tabInfo;
  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (e) {
    console.warn(`[${logLabel}] 读取 OAuth 回调页面失败:`, e);
    return null;
  }

  let code = null;
  try {
    const oauthUrl = new URL(tabInfo.url || '');
    code = oauthUrl.searchParams.get('code');
  } catch (e) {
    return null;
  }

  if (!code) return null;

  console.log(`[${logLabel}] 手动调用 OAuth 回调 API...`);
  try {
    const callbackResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (authCode) => {
        try {
          const resp = await fetch(`/api/oauth/linuxdo?code=${authCode}`, {
            method: 'GET',
            credentials: 'include'
          });
          const data = await resp.json();
          console.log('[OAuth 回调] API 响应:', data);

          if (data.success && data.data) {
            localStorage.setItem('user', JSON.stringify(data.data));
            console.log('[OAuth 回调] 已将用户数据写入 localStorage');
          }

          await new Promise(r => setTimeout(r, 1000));

          const hasUser = localStorage.getItem('user') !== null;
          return { success: true, apiResponse: data, hasUser };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [code]
    });
    const callbackResult = callbackResults[0]?.result;
    console.log(`[${logLabel}] 回调 API 结果:`, JSON.stringify(callbackResult).substring(0, 300));
    return callbackResult || null;
  } catch (e) {
    console.warn(`[${logLabel}] 手动调用回调 API 失败:`, e.message);
    return null;
  }
}

async function buildNewApiLoggedInTabHeaders(domain, visitUrl, tabId, logLabel = 'OAuth') {
  let tabInfo = await chrome.tabs.get(tabId);
  if (!tabInfo.url || !tabInfo.url.includes(domain) || isTargetDomainLoginPage(tabInfo.url, domain)) {
    console.warn(`[${logLabel}] OAuth 后未进入已登录目标页面: ${tabInfo.url}`);
    return null;
  }

  await processNewApiOAuthCallback(tabId, logLabel);

  let session = null;
  for (let retry = 0; retry < 5; retry++) {
    await sleep(2000);
    session = await inspectNewApiBrowserSession(tabId);
    console.log(`[${logLabel}] session 检查 (${retry + 1}/5):`, JSON.stringify({
      hasUser: session?.hasUser,
      userAuthenticated: session?.userAuthenticated,
      selfStatus: session?.selfStatus,
      hasToken: Boolean(session?.token)
    }));
    if (session?.success && hasNewApiUserSession(session)) break;

    tabInfo = await chrome.tabs.get(tabId).catch(() => tabInfo);
    if (isTargetDomainLoginPage(tabInfo?.url, domain)) {
      console.warn(`[${logLabel}] session 检查时又回到登录页`);
      return null;
    }
  }

  if (!session?.success || !hasNewApiUserSession(session)) {
    console.warn(`[${logLabel}] OAuth 后仍未检测到 NewAPI 登录态`);
    return null;
  }

  try {
    await chrome.tabs.reload(tabId);
    await ensureTabPageReady(tabId, tabInfo.url || `https://${domain}/`, 15000);
    await sleep(2000);
  } catch (e) {
    console.warn(`[${logLabel}] OAuth 后刷新失败，继续捕获认证头:`, e);
  }

  const postLoginUrl = getNewApiPostLoginUrl(domain, visitUrl);
  await chrome.tabs.update(tabId, { url: postLoginUrl, active: false });
  await ensureTabPageReady(tabId, postLoginUrl, 15000);
  await sleep(2000);

  let headers = await captureAuthHeaders(domain, tabId, { timeout: 8000 });
  session = await inspectNewApiBrowserSession(tabId);
  const cookies = await chrome.cookies.getAll({ domain });
  headers = buildNewApiExistingSessionHeaders({
    cookies,
    user: session?.user,
    token: session?.token,
    tabId,
    baseHeaders: headers || {}
  });

  if (!headers.Cookie && !headers.cookie && !headers.Authorization) {
    console.warn(`[${logLabel}] 未能构建 NewAPI 认证头`);
    return null;
  }

  return { headers, tabId };
}

async function tryNewApiSiteLoginOAuth(domain, visitUrl, tab, tabSession = null) {
  if (!tab?.id) return null;
  try {
    let tabInfo = await chrome.tabs.get(tab.id);
    if (!isTargetDomainLoginPage(tabInfo.url, domain)) {
      const navigated = await navigateToTargetSiteLoginPage(tab.id, domain, 0, 20000);
      tabInfo = navigated.tabInfo || await chrome.tabs.get(tab.id);
    }

    if (!isTargetDomainLoginPage(tabInfo.url, domain)) {
      console.warn(`[OAuth] 未进入站点登录页，无法使用页面登录入口: ${tabInfo.url}`);
      return null;
    }

    const started = await startSiteLinuxDoOAuthFromLoginPage(
      tab.id,
      domain,
      getNewApiPostLoginUrl(domain, visitUrl),
      'OAuth'
    );
    if (started?.securityCheck) {
      return { securityCheck: true, tabId: started.tabId || tab.id };
    }
    if (!started?.tabId) return null;

    return await buildNewApiLoggedInTabHeaders(domain, visitUrl, started.tabId, 'OAuth');
  } catch (e) {
    console.warn('[OAuth] 站点登录页 OAuth 失败:', e);
    await closeTabUnlessInSession(tab?.id, tabSession);
    return null;
  }
}

async function clickLinuxDoAuthorizeButton(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          'button',
          'input[type="submit"]',
          'a[class*="btn"]',
          '[role="button"]'
        ];
        const candidates = document.querySelectorAll(selectors.join(','));
        for (const el of candidates) {
          const text = (el.textContent || el.value || '').trim();
          if (/allow|允许|授权|approve|accept|Authorize|同意/i.test(text)) {
            el.click();
            return `clicked: ${text}`;
          }
        }

        const form = document.querySelector('form');
        const submit = form?.querySelector('button, input[type="submit"]');
        if (submit) {
          submit.click();
          return 'clicked form submit';
        }

        return 'no authorize button found';
      }
    });
    console.log('[ZenAPI OAuth] 授权页点击结果:', results[0]?.result);
  } catch (e) {
    console.warn('[ZenAPI OAuth] 点击授权按钮失败:', e);
  }
}

async function readSub2ApiAuthHeadersFromTab(tabId, baseHeaders = {}) {
  return readStorageTokenAuthHeadersFromTab(tabId, ['auth_token', 'access_token', 'token'], baseHeaders, 'Sub2API');
}

async function readStorageTokenAuthHeadersFromTab(tabId, tokenKeys, baseHeaders = {}, logLabel = 'Auth') {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (keys) => {
        const tokenKeys = Array.isArray(keys) ? keys : [];
        for (const key of tokenKeys) {
          const token = localStorage.getItem(key) || sessionStorage.getItem(key);
          if (token) return token;
        }
        return null;
      },
      args: [tokenKeys]
    });

    const token = results[0]?.result;
    const headers = mergeAuthorizationHeader(baseHeaders || {}, token);
    headers._tabId = tabId;
    return headers;
  } catch (e) {
    console.warn(`[${logLabel}] 读取页面登录令牌失败:`, e);
    return baseHeaders || {};
  }
}

function formatResult(execResult) {
  if (execResult.invalidSite) {
    return { status: 'invalid', message: execResult.message || '站点页面失效' };
  }
  if (execResult.error) {
    return { status: 'failed', message: execResult.error };
  }
  if (execResult.fallbackClicked && execResult.success) {
    return { status: 'success', message: execResult.message };
  }
  if (execResult.alreadyCheckedIn) {
    return { status: 'already', message: execResult.message };
  }
  return {
    status: execResult.success ? 'success' : 'failed',
    message: execResult.message
  };
}

async function buildResultWithLatestBalance(site, execResult, authHeaders, tabId = null) {
  const result = formatResult(execResult);
  const balance = await fetchLatestBalance(site, authHeaders, tabId, execResult);
  if (balance) result.balance = balance;
  return result;
}

async function buildHumanVerificationCheckInResult(site, tabId = null, tabSession = null) {
  const execResult = buildHumanVerificationResult();
  const result = await buildResultWithLatestBalance(site, execResult, null, tabId);
  const fallbackOptions = await getOfficialPageFallbackOptions();
  if (fallbackOptions.focusHumanVerificationWindow && tabId) {
    await focusTabWindow(tabId);
  } else {
    await closeTabUnlessInSession(tabId, tabSession);
  }
  return result;
}

async function fetchLatestBalance(site, authHeaders, tabId = null, execResult = null) {
  const fromResponse = extractBalanceFromCheckInResult(execResult);
  if (fromResponse) return fromResponse;

  const candidates = getBalanceQueryUrls(site);
  for (const url of candidates) {
    try {
      const response = await doFetchWithHeaders(url, 'GET', null, authHeaders || {});
      const fromData = extractBalanceFromData(response?.data);
      if (fromData) return fromData;
    } catch (e) {
      console.warn(`${site.siteName} 余额接口读取失败 ${url}:`, e);
    }
  }

  if (tabId) {
    const fromPage = await readBalanceFromTab(tabId, site);
    if (fromPage) return fromPage;
  }

  return null;
}

function getBalanceQueryUrls(site) {
  const urls = [
    site.signQueryUrl,
    `https://${site.cookieDomain}/api/user/self`,
    `https://${site.cookieDomain}/api/status`,
    `https://${site.cookieDomain}/api/u/dashboard`,
    `https://${site.cookieDomain}/api/v1/user/info`,
    `https://${site.cookieDomain}/api/v1/user`
  ];
  return [...new Set(urls.filter(Boolean))];
}

async function readBalanceFromTab(tabId, site) {
  try {
    await chrome.tabs.get(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (isSub2Api) => ({
        bodyText: document.body?.innerText || '',
        sub2ApiBalanceTexts: isSub2Api
          ? Array.from(document.querySelectorAll('.text-sm.font-semibold'))
            .map(el => el.textContent || '')
          : []
      }),
      args: [site?.type === 'sub2api']
    });
    const pageBalance = results[0]?.result || {};
    if (site?.type === 'sub2api') {
      const fromSub2ApiPage = extractSub2ApiBalanceFromTexts(pageBalance.sub2ApiBalanceTexts || []);
      if (fromSub2ApiPage) return fromSub2ApiPage;
    }
    return extractBalanceFromText(pageBalance.bodyText || '');
  } catch (e) {
    console.warn(`${site.siteName} 页面余额读取失败:`, e);
    return null;
  }
}

// 通过 webRequest 捕获页面真实请求头
function captureAuthHeaders(domain, tabId, { timeout = 25000 } = {}) {
  return new Promise(async (resolve) => {
    let resolved = false;

    function onCapture(headers) {
      if (resolved) return;
      resolved = true;
      chrome.webRequest.onSendHeaders.removeListener(listener);
      headers._tabId = tabId; // 保存tabId用于后续在标签页中执行请求
      resolve(headers);
    }

    function listener(details) {
      if (resolved || details.tabId !== tabId) return;

      const headers = {};
      for (const h of (details.requestHeaders || [])) {
        headers[h.name] = h.value;
      }

      console.log(`[webRequest] 捕获到 ${details.url} 的请求头:`, Object.keys(headers));
      onCapture(headers);
    }

    // 监听目标域名的 API 请求
    chrome.webRequest.onSendHeaders.addListener(
      listener,
      { urls: [`https://${domain}/api/*`], tabId: tabId },
      ['requestHeaders', 'extraHeaders']
    );

    // 检查当前URL，如果是登录页面，先导航到登录页
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && (isTargetDomainLoginPage(tab.url, domain) || tab.url.includes('expired=true'))) {
        console.log(`[webRequest] 标签页在登录页面，先导航到登录页...`);
        await navigateToTargetSiteLoginPage(tabId, domain, 0, 20000);
        await sleep(20000); // 等待Cloudflare验证完成（20秒）
      }
    } catch (e) {
      console.warn('检查标签页URL失败:', e);
    }

    // 刷新页面以触发 API 请求
    console.log(`[webRequest] 刷新标签页 ${tabId} 以捕获请求头...`);
    try {
      await chrome.tabs.reload(tabId);
    } catch (e) {
      console.warn('刷新标签页失败:', e);
    }

    // 等待页面加载完成 + API 请求发出
    await sleep(timeout);

    // 超时
    if (!resolved) {
      resolved = true;
      chrome.webRequest.onSendHeaders.removeListener(listener);
      console.warn(`[webRequest] 超时未捕获到 ${domain} 的 API 请求`);
      resolve(null);
    }
  });
}

// 用捕获的头发起签到请求（从 service worker 发起）
async function doCheckInRequest(url, method, params, capturedHeaders) {
  // 优先使用 service worker fetch（更快），只有在需要时才使用标签页
  // 如果有 _needsTabExecution 标记，说明该站点需要在标签页中执行
  const needsTabExecution = capturedHeaders._needsTabExecution;
  let tabId = capturedHeaders._tabId;

  // 检查标签页是否存在
  if (tabId && needsTabExecution) {
    try {
      await chrome.tabs.get(tabId);
      // 标签页存在，可以使用
    } catch (e) {
      // 标签页不存在，移除 tabId
      console.log(`[fetch-in-tab] 标签页 ${tabId} 不存在，回退到 service worker fetch`);
      tabId = null;
    }
  }

  if (tabId && needsTabExecution) {
    console.log(`[fetch-in-tab] 站点需要 Cloudflare 绕过，在标签页 ${tabId} 中执行: ${method} ${url}`);

    // 提取认证相关的头
    const headers = { 'Content-Type': 'application/json' };
    const authKeys = ['authorization', 'cookie', 'session', 'token', 'x-token', 'x-auth', 'new-api'];

    for (const [name, value] of Object.entries(capturedHeaders)) {
      if (name.startsWith('_')) continue; // 跳过临时标记
      const lower = name.toLowerCase();
      if (authKeys.some(k => lower.includes(k))) {
        headers[name] = value;
      }
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async (fetchUrl, fetchMethod, fetchParams, fetchHeaders, successOnHttpOk) => {
          try {
            const options = {
              method: fetchMethod,
              headers: fetchHeaders,
              credentials: 'include'
            };
            if (fetchMethod === 'POST' && fetchParams && Object.keys(fetchParams).length > 0) {
              options.body = JSON.stringify(fetchParams);
            }

            const response = await fetch(fetchUrl, options);
            if (response.status === 404 || response.status === 410) {
              return {
                success: false,
                invalidSite: true,
                message: '站点页面失效',
                httpStatus: response.status
              };
            }
            const text = await response.text();

            // 尝试解析JSON
            let data;
            try {
              data = JSON.parse(text);
            } catch (e) {
              return { error: 'Response is not JSON: ' + text.substring(0, 100), httpStatus: response.status };
            }

            const zenApiAlreadyCheckedIn = data?.already_checked_in === true;
            const success =
              data.success === true ||
              data.status === 'success' ||
              data.ret === 1 ||
              data.code === 0 ||
              data.ok === true ||
              (successOnHttpOk === true && response.ok);
            const reward = Number(data?.reward);
            const message =
              data.message ||
              data.msg ||
              (zenApiAlreadyCheckedIn ? '今日已签到' : null) ||
              (Number.isFinite(reward) ? `签到成功，获得 $${reward.toFixed(2)}` : null) ||
              data.data ||
              '签到完成';
            const msgStr = typeof message === 'string' ? message : JSON.stringify(message);

            const alreadyKeywords = ['已签到', '已经签到', '已签过', '今日已签', 'already', '重复签到'];
            const alreadyCheckedIn = zenApiAlreadyCheckedIn || alreadyKeywords.some(k => msgStr.includes(k));

            return {
              success: success || alreadyCheckedIn,
              alreadyCheckedIn,
              message: msgStr,
              httpStatus: response.status,
              data
            };
          } catch (e) {
            return { error: e.message, success: false, httpStatus: 0 };
          }
        },
        args: [url, method, params, headers, capturedHeaders._successOnHttpOk === true]
      });

      const result = results[0]?.result;
      console.log(`[fetch-in-tab] 结果:`, result);
      return result || { error: 'No result from tab', success: false };
    } catch (e) {
      console.error(`[fetch-in-tab] 失败:`, e);
      // 回退到background fetch
    }
  }

  // 回退：在background中执行
  return doFetchWithHeaders(url, method, params, capturedHeaders);
}

async function doFetchWithHeaders(url, method, params, capturedHeaders) {
  // 提取认证相关的头
  const headers = { 'Content-Type': 'application/json' };
  const authKeys = ['authorization', 'cookie', 'session', 'token', 'x-token', 'x-auth', 'new-api'];

  for (const [name, value] of Object.entries(capturedHeaders)) {
    const lower = name.toLowerCase();
    if (authKeys.some(k => lower.includes(k))) {
      headers[name] = value;
    }
  }

  // 也保留 user-agent 和 referer
  if (capturedHeaders['User-Agent']) headers['User-Agent'] = capturedHeaders['User-Agent'];
  if (capturedHeaders['Referer']) headers['Referer'] = capturedHeaders['Referer'];

  console.log(`[fetch] ${method} ${url} 使用头:`, Object.keys(headers));
  console.log(`[fetch] 详细请求头:`, JSON.stringify(headers, null, 2).substring(0, 500));

  const options = { method, headers };
  if (method === 'POST' && params && Object.keys(params).length > 0) {
    options.body = JSON.stringify(params);
  }

    try {
      const response = await fetch(url, options);
      if (isInvalidHttpStatus(response.status)) {
        return { success: false, invalidSite: true, message: '站点页面失效', httpStatus: response.status };
      }
      const data = await response.json();

    console.log(`[fetch] 响应状态: ${response.status}, 数据:`, JSON.stringify(data).substring(0, 200));

    return parseCheckInResponse(data, response.status, capturedHeaders._successOnHttpOk === true);
  } catch (e) {
    console.error(`[fetch] 请求失败:`, e);
    return { error: e.message, success: false, httpStatus: 0 };
  }
}

// 缓存/读取认证头
async function cacheHeaders(siteId, headers) {
  const data = await chrome.storage.local.get('authHeadersCache');
  const cache = data.authHeadersCache || {};
  cache[siteId] = { headers, cachedAt: Date.now() };
  await chrome.storage.local.set({ authHeadersCache: cache });
}

async function getCachedHeaders(siteId) {
  const data = await chrome.storage.local.get('authHeadersCache');
  const cache = data.authHeadersCache || {};
  const entry = cache[siteId];
  if (!entry) return null;

  // 缓存 7 天过期（401 时会自动刷新）
  if (Date.now() - entry.cachedAt > 7 * 24 * 60 * 60 * 1000) {
    return null;
  }
  return entry.headers;
}

async function clearCachedHeaders(siteId) {
  const data = await chrome.storage.local.get('authHeadersCache');
  const cache = data.authHeadersCache || {};
  delete cache[siteId];
  await chrome.storage.local.set({ authHeadersCache: cache });
}

async function getNewApiAuthHeaders(site, { forceRefresh = false, needsTabExecution = false } = {}, tabSession = null) {
  if (!forceRefresh) {
    const cachedHeaders = await getCachedHeaders(site.siteId);
    if (cachedHeaders) {
      console.log(`${site.siteName} 使用缓存认证头`);
      return { headers: cachedHeaders, tabToCleanup: null, source: 'cache' };
    }
  }

  console.log(`${site.siteName} 无可用缓存，先检查浏览器已有登录态...`);
  const existingSession = await getNewApiExistingSessionAuthHeaders(site, { needsTabExecution }, tabSession);
  if (existingSession?.securityCheck) {
    return { securityCheck: true, tabToCleanup: existingSession.tabToCleanup || null, source: 'security-check' };
  }
  if (existingSession?.headers && !shouldTryNewApiOAuth({ hasExistingSessionHeaders: true })) {
    await cacheHeaders(site.siteId, existingSession.headers);
    console.log(`${site.siteName} 已复用浏览器已有登录态`);
    return existingSession;
  }

  console.log(`${site.siteName} 未检测到可复用登录态，尝试 linux.do OAuth...`);
  const oauthResult = await autoOAuthLogin(site.cookieDomain, site.visitUrl, tabSession);
  if (oauthResult?.securityCheck) {
    return { securityCheck: true, tabToCleanup: oauthResult.tabId || null, source: 'security-check' };
  }
  if (oauthResult?.headers) {
    if (needsTabExecution) {
      oauthResult.headers._needsTabExecution = true;
    }
    await cacheHeaders(site.siteId, oauthResult.headers);
    console.log(`${site.siteName} OAuth 登录成功`);
    return { headers: oauthResult.headers, tabToCleanup: oauthResult.tabId || null, source: 'oauth' };
  }

  return null;
}

async function getNewApiExistingSessionAuthHeaders(site, { needsTabExecution = false } = {}, tabSession = null) {
  const tab = await openSiteSessionTab(tabSession, getNewApiPostLoginUrl(site.cookieDomain, site.visitUrl), 15000);
  try {
    await sleep(1500);

    const loginRecovery = await recoverAutomationLoginPageIfNeeded(site, tab.id, tabSession, `${site.siteName} NewAPI 登录态`);
    if (loginRecovery.securityCheck) {
      return { securityCheck: true, tabToCleanup: loginRecovery.tabId || tab.id, source: 'security-check' };
    }
    if (loginRecovery.recovered && loginRecovery.headers) {
      return { headers: loginRecovery.headers, tabToCleanup: loginRecovery.tabId || tab.id, source: 'login-page-oauth' };
    }
    if (loginRecovery.failed) {
      await closeTabUnlessInSession(loginRecovery.tabId || tab.id, tabSession);
      return null;
    }

    const session = await inspectNewApiBrowserSession(tab.id);
    console.log(`${site.siteName} 浏览器登录态检查:`, JSON.stringify({
      hasUser: session?.hasUser,
      userAuthenticated: session?.userAuthenticated,
      selfStatus: session?.selfStatus,
      hasToken: Boolean(session?.token)
    }));

    if (!session?.success || !hasNewApiUserSession(session)) {
      await closeTabUnlessInSession(tab.id, tabSession);
      return null;
    }

    const cookies = await chrome.cookies.getAll({ domain: site.cookieDomain });
    let headers = buildNewApiExistingSessionHeaders({
      cookies,
      user: session.user,
      token: session.token,
      tabId: tab.id
    });

    if (!headers.Cookie && !headers.cookie && !headers.Authorization) {
      const capturedHeaders = await captureAuthHeaders(site.cookieDomain, tab.id, { timeout: 5000 });
      headers = buildNewApiExistingSessionHeaders({
        cookies,
        user: session.user,
        token: session.token,
        tabId: tab.id,
        baseHeaders: capturedHeaders || headers
      });
    }

    if (needsTabExecution) {
      headers._needsTabExecution = true;
    }

    return { headers, tabToCleanup: tab.id, source: 'browser-session' };
  } catch (e) {
    console.warn(`${site.siteName} 检查浏览器已有登录态失败:`, e);
    await closeTabUnlessInSession(tab.id, tabSession);
    return null;
  }
}

async function inspectNewApiBrowserSession(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        const user = localStorage.getItem('user');
        const token = localStorage.getItem('token') || localStorage.getItem('access_token') || localStorage.getItem('auth_token');
        let selfData = null;
        let selfStatus = 0;
        let userAuthenticated = false;

        try {
          const selfResp = await fetch('/api/user/self', { credentials: 'include' });
          selfStatus = selfResp.status;
          selfData = await selfResp.json();
          userAuthenticated = selfResp.ok &&
            selfStatus !== 401 &&
            selfData?.success !== false &&
            Boolean(selfData?.data || selfData?.success === true);
        } catch (e) {}

        return {
          success: true,
          hasUser: user !== null,
          user,
          token,
          userAuthenticated,
          selfStatus,
          selfData
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  });

  return results[0]?.result || null;
}

// ============== Auto OAuth Login ==============

// 等待标签页加载完成
function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    function finish(val) {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(val);
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => {
      if (t.status === 'complete') finish(true);
    }).catch(() => finish(false));
    setTimeout(() => finish(false), timeout);
  });
}

async function ensureTabPageReady(tabId, url, timeout = 15000) {
  const loaded = await waitForTabComplete(tabId, timeout);
  let tabInfo = await chrome.tabs.get(tabId);
  if (isInvalidTabUrl(tabInfo.url)) {
    throw createInvalidSiteError(url || tabInfo.url);
  }
  if (!loaded) {
    throw new Error('页面加载超时');
  }

  const usable = await waitForUsableTabPage(tabId, PAGE_USABLE_TIMEOUT_MS);
  tabInfo = await chrome.tabs.get(tabId);
  if (isInvalidTabUrl(tabInfo.url)) {
    throw createInvalidSiteError(url || tabInfo.url);
  }
  if (!usable) {
    throw new Error('页面空白或无响应');
  }
  return tabInfo;
}

async function waitForUsableTabPage(tabId, timeout = PAGE_USABLE_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const body = document.body;
          if (!body) return { usable: false };
          const text = (body.innerText || '').replace(/\s+/g, ' ').trim();
          if (text.length > 0) return { usable: true, reason: 'text' };

          const visibleSelectors = [
            'button',
            'input',
            'textarea',
            'select',
            'a[href]',
            '[role="button"]',
            '[onclick]',
            'iframe',
            'canvas',
            'svg',
            'img[src]',
            'video',
            '[class*="spinner"]',
            '[class*="loading"]',
            '[class*="skeleton"]'
          ].join(', ');
          const candidates = Array.from(document.querySelectorAll(visibleSelectors));
          const hasVisibleElement = candidates.some((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              rect.width > 0 &&
              rect.height > 0;
          });
          return { usable: hasVisibleElement, reason: hasVisibleElement ? 'visible-element' : 'blank' };
        }
      });
      if (results[0]?.result?.usable) return true;
    } catch (e) {
      console.warn('检查页面可用性失败:', e);
      return true;
    }
    await sleep(500);
  }
  return false;
}

// 等待标签页 URL 匹配目标域名
function waitForTabUrlMatch(tabId, domain, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false;
    function finish(val) {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(val);
    }
    function listener(id, info, tab) {
      if (id === tabId && tab.url && tab.url.includes(domain)) finish(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => {
      if (t.url && t.url.includes(domain)) finish(true);
    }).catch(() => {});
    setTimeout(() => finish(false), timeout);
  });
}

function waitForTabUrlChange(tabId, previousUrl, timeout = 10000) {
  return new Promise((resolve) => {
    let done = false;
    function finish(val) {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(val);
    }
    function listener(id, info, tab) {
      if (id === tabId && tab.url && tab.url !== previousUrl) finish(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => {
      if (t.url && t.url !== previousUrl) finish(true);
    }).catch(() => {});
    setTimeout(() => finish(false), timeout);
  });
}

// 自动通过 linux.do OAuth 登录目标站点
async function autoOAuthLogin(domain, visitUrl, tabSession = null) {
  console.log(`[OAuth] 开始自动登录: ${domain}`);

  // 1. 获取 linuxdo_client_id（在标签页上下文中执行以绕过 Cloudflare）
  let clientId;
  let tab;
  async function fallbackToSiteLogin(reason) {
    console.warn(`[OAuth] ${reason}，改用站点登录页 Linux.do 入口`);
    const fallback = await tryNewApiSiteLoginOAuth(domain, visitUrl, tab, tabSession);
    if (fallback?.securityCheck) return fallback;
    if (fallback?.headers) return fallback;
    await closeTabUnlessInSession(tab?.id, tabSession);
    return null;
  }

  try {
    // 创建临时后台标签页，避免复用或打断用户正在浏览的页面
    tab = await openSiteSessionTab(tabSession, `https://${domain}/`);

    // 在标签页中执行 fetch 请求
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try {
          const resp = await fetch('/api/status');
          const data = await resp.json();
          return { success: true, data: data };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    });

    const result = results[0]?.result;
    if (!result?.success) {
      console.warn(`[OAuth] 获取 status 失败:`, result?.error);
      return await fallbackToSiteLogin('获取 status 失败');
    }

    clientId = result.data?.data?.linuxdo_client_id || result.data?.linuxdo_client_id;
    if (!clientId) {
      console.warn(`[OAuth] ${domain} 无 linuxdo_client_id`);
      return await fallbackToSiteLogin('无 linuxdo_client_id');
    }
    console.log(`[OAuth] client_id: ${clientId}`);
  } catch (e) {
    console.warn(`[OAuth] 获取 status 失败:`, e);
    return await fallbackToSiteLogin('获取 status 异常');
  }

  // 2. 检查 linux.do 登录状态
  const ldCookies = await chrome.cookies.getAll({ domain: 'linux.do' });
  if (ldCookies.length === 0) {
    console.warn('[OAuth] linux.do 未登录');
    await closeTabUnlessInSession(tab.id, tabSession);
    return null;
  }
  console.log(`[OAuth] linux.do cookies: ${ldCookies.length} 个`);

  // 2.5. 获取 OAuth state (CSRF 保护) - 在标签页中执行以绕过 Cloudflare
  let state;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try {
          const resp = await fetch('/api/oauth/state', { credentials: 'include' });
          const data = await resp.json();
          return { success: true, data: data };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    });

    const result = results[0]?.result;
    if (!result?.success || !result?.data?.success || !result?.data?.data) {
      console.warn('[OAuth] 获取 state 失败:', result);
      return await fallbackToSiteLogin('获取 state 失败');
    }
    state = result.data.data;
    console.log(`[OAuth] 获取 state: ${state}`);
  } catch (e) {
    console.warn('[OAuth] 获取 state 异常:', e);
    return await fallbackToSiteLogin('获取 state 异常');
  }

  // 3. 在同一个标签页中打开 OAuth 授权页面
  const oauthUrl = buildNewApiLinuxDoOAuthUrl(clientId, state);
  console.log(`[OAuth] 打开: ${oauthUrl}`);
  try {
    await chrome.tabs.update(tab.id, { url: oauthUrl });
    console.log(`[OAuth] 使用标签页 ${tab.id} 进行 OAuth 授权`);
  } catch (e) {
    console.error('[OAuth] 更新标签页失败:', e);
    await closeTabUnlessInSession(tab.id, tabSession);
    return null;
  }

  try {
    // 4. 等待页面加载
    await ensureTabPageReady(tab.id, oauthUrl, 15000);
    await sleep(1000);

    let tabInfo = await chrome.tabs.get(tab.id);
    console.log(`[OAuth] 页面加载完成: ${tabInfo.url}`);

    // 5. 如果还在授权页面，尝试点击"允许"按钮
    if (tabInfo.url && tabInfo.url.includes('connect.linux.do')) {
      const securityCheckResult = await getAutomationHumanVerificationResult(tab.id);
      if (securityCheckResult) {
        return { securityCheck: true, tabId: tab.id };
      }
      console.log('[OAuth] 在授权页面，点击允许按钮...');
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // 搜索所有可能的按钮元素（包括 a.btn-pill 等链接按钮）
            const btns = document.querySelectorAll('button, input[type="submit"], a[class*="btn"], [role="button"]');
            for (const btn of btns) {
              const text = (btn.textContent || btn.value || '').trim();
              if (/allow|允许|授权|approve|accept|Authorize|同意/i.test(text)) {
                btn.click();
                return 'clicked: ' + text;
              }
            }
            // 回退：查找包含允许文本的任意链接
            const links = document.querySelectorAll('a[href*="approve"], a[href*="authorize"]');
            for (const link of links) {
              link.click();
              return 'clicked approve link: ' + link.href;
            }
            // 回退：提交表单
            const form = document.querySelector('form');
            if (form) {
              const sub = form.querySelector('[type="submit"], button');
              if (sub) { sub.click(); return 'clicked form submit'; }
            }
            return 'no button found';
          }
        });
        console.log('[OAuth] 点击结果:', results[0]?.result);
      } catch (e) {
        console.warn('[OAuth] 注入脚本失败:', e);
      }

      // 等待重定向到目标域名
      const redirected = await waitForTabUrlMatch(tab.id, domain, 20000);
      if (!redirected) {
        console.warn('[OAuth] 重定向超时');
        return await fallbackToSiteLogin('OAuth 重定向超时');
      }
      await ensureTabPageReady(tab.id, `https://${domain}/`, 15000);
      tabInfo = await chrome.tabs.get(tab.id);
      if (isTargetDomainLoginPage(tabInfo.url, domain)) {
        return await fallbackToSiteLogin('OAuth 回跳后进入登录页');
      }
    }

    // 6. 验证已到达目标域名
    tabInfo = await chrome.tabs.get(tab.id);
    if (!tabInfo.url || !tabInfo.url.includes(domain)) {
      console.warn(`[OAuth] 未到达目标域: ${tabInfo.url}`);
      return await fallbackToSiteLogin('OAuth 未到达目标域');
    }
    if (isTargetDomainLoginPage(tabInfo.url, domain)) {
      return await fallbackToSiteLogin('OAuth 停在登录页');
    }
    console.log(`[OAuth] 登录完成: ${tabInfo.url}`);

    // 7. 等待前端 JS 处理 OAuth 回调（交换 code、保存 token 到 localStorage/cookie）
    console.log('[OAuth] 等待前端处理 OAuth 回调...');

    // 7.5. 手动触发 OAuth 回调处理（某些站点的前端 JS 可能不会自动执行）
    await processNewApiOAuthCallback(tab.id, 'OAuth');

    // 7.6. 验证 session 是否已建立（在页面上下文中检查）
    let sessionEstablished = false;
    for (let retry = 0; retry < 5; retry++) {
      await sleep(2000);
      console.log(`[OAuth] 验证 session 是否建立 (尝试 ${retry + 1}/5)...`);

      try {
        const currentTab = await chrome.tabs.get(tab.id);
        if (isTargetDomainLoginPage(currentTab.url, domain)) {
          return await fallbackToSiteLogin('验证 session 时进入登录页');
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async () => {
            try {
              // 检查 localStorage 中是否有 user 键（旧版 New API 会写入 user）
              const hasUser = localStorage.getItem('user') !== null;
              let statusData = null;
              let selfData = null;
              let selfStatus = 0;
              let userAuthenticated = false;

              try {
                const statusResp = await fetch('/api/status', { credentials: 'include' });
                statusData = await statusResp.json();
              } catch (e) {}

              try {
                const selfResp = await fetch('/api/user/self', { credentials: 'include' });
                selfStatus = selfResp.status;
                selfData = await selfResp.json();
                userAuthenticated = selfResp.ok &&
                  selfStatus !== 401 &&
                  selfData?.success !== false &&
                  Boolean(selfData?.data || selfData?.success === true);
              } catch (e) {}

              return {
                success: true,
                hasUser: hasUser,
                userAuthenticated: userAuthenticated,
                data: statusData,
                selfStatus: selfStatus,
                selfData: selfData
              };
            } catch (e) {
              return { success: false, error: e.message };
            }
          }
        });
        const result = results[0]?.result;
        console.log(`[OAuth] 页面上下文检查结果:`, JSON.stringify(result).substring(0, 300));
        console.log(`[OAuth] localStorage 有 user 键: ${result?.hasUser}, /api/user/self 已认证: ${result?.userAuthenticated}`);

        if (result?.success && hasNewApiUserSession(result)) {
          sessionEstablished = true;
          console.log('[OAuth] session 已建立且用户已登录');
          break;
        } else if (result?.success) {
          console.log('[OAuth] 尚未检测到已登录用户 session，继续等待...');
        }
      } catch (e) {
        console.warn(`[OAuth] 验证失败:`, e.message);
      }
    }

    if (!sessionEstablished) {
      console.warn('[OAuth] session 未建立，OAuth 可能失败');
      return await fallbackToSiteLogin('session 未建立');
    }

    // 7.6. 在 OAuth 回调页面刷新，强制浏览器写入新 cookie
    console.log('[OAuth] 在 OAuth 回调页面刷新以写入 cookie...');
    await chrome.tabs.reload(tab.id);
    await ensureTabPageReady(tab.id, tabInfo.url || `https://${domain}/`, 15000);
    await sleep(2000);

    // 8. 导航到用户配置页以捕获认证头（session 已在 OAuth 回调页面建立）
    const postLoginUrl = getNewApiPostLoginUrl(domain, visitUrl);
    console.log(`[OAuth] 导航到用户页以捕获认证头: ${postLoginUrl}`);
    await chrome.tabs.update(tab.id, { url: postLoginUrl });
    await ensureTabPageReady(tab.id, postLoginUrl, 15000);
    await sleep(2000);

    // 9. 捕获认证头（刷新首页触发正常的 API 请求，携带有效 session）
    const headers = await captureAuthHeaders(domain, tab.id);
    if (!headers || Object.keys(headers).length === 0) {
      console.warn('[OAuth] 未捕获到认证头');
      await closeTabUnlessInSession(tab.id, tabSession);
      return null;
    }
    console.log('[OAuth] 捕获到的请求头:', JSON.stringify(Object.keys(headers)));

    // 10. 如果没有捕获到 Cookie，尝试从 chrome.cookies API 读取
    if (!headers['Cookie'] && !headers['cookie']) {
      console.log('[OAuth] 未捕获到 Cookie，尝试从 cookies API 读取...');
      const cookies = await chrome.cookies.getAll({ domain: domain });
      console.log(`[OAuth] cookies API 返回 ${cookies.length} 个 cookie:`, cookies.map(c => c.name));
      if (cookies.length > 0) {
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        headers['Cookie'] = cookieStr;
        console.log(`[OAuth] 设置 Cookie 头: ${cookieStr.substring(0, 100)}...`);
      }
    } else {
      console.log('[OAuth] 已捕获到 Cookie 头');
    }

    // 11. 尝试从 localStorage 读取 token（某些站点使用 localStorage 而非 cookie）
    try {
      console.log('[OAuth] 尝试从 localStorage 读取 token...');
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const token = localStorage.getItem('token') || localStorage.getItem('access_token') || localStorage.getItem('auth_token');
          const allKeys = Object.keys(localStorage);
          return { token, allKeys };
        }
      });
      const result = results[0]?.result;
      console.log('[OAuth] localStorage 所有 key:', result?.allKeys);
      const token = result?.token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log('[OAuth] 从 localStorage 读取到 token:', token.substring(0, 20) + '...');
      } else {
        console.log('[OAuth] localStorage 中未找到 token');
      }
    } catch (e) {
      console.warn('[OAuth] 读取 localStorage 失败:', e);
    }

    // 12. 验证捕获的认证头是否有效（测试 /api/status 接口）
    console.log('[OAuth] 验证认证头有效性...');
    console.log('[OAuth] 当前请求头:', JSON.stringify(Object.keys(headers)));
    try {
      const testResult = await doFetchWithHeaders(`https://${domain}/api/status`, 'GET', null, headers);
      console.log('[OAuth] 验证请求返回状态:', testResult.httpStatus);
      console.log('[OAuth] 验证请求返回数据:', JSON.stringify(testResult.data));
      if (testResult.httpStatus === 401) {
        console.warn('[OAuth] 认证头无效（401），可能需要更长等待时间');
        // 再等待一段时间后重试
        await sleep(3000);
        console.log('[OAuth] 等待 3 秒后重新捕获认证头...');
        const retryHeaders = await captureAuthHeaders(domain, tab.id);
        if (retryHeaders && Object.keys(retryHeaders).length > 0) {
          console.log('[OAuth] 重新捕获认证头成功，请求头:', JSON.stringify(Object.keys(retryHeaders)));
          return { headers: retryHeaders, tabId: tab.id };
        } else {
          console.warn('[OAuth] 重新捕获认证头失败');
        }
      } else {
        console.log('[OAuth] 认证头验证通过');
      }
    } catch (e) {
      console.warn('[OAuth] 验证认证头失败:', e);
    }

    return { headers, tabId: tab.id };
  } catch (e) {
    console.error('[OAuth] 失败:', e);
    await closeTabUnlessInSession(tab?.id, tabSession);
    return null;
  }
}

async function createTemporaryBackgroundTab(url, timeout = 15000, options = {}) {
  const tab = await chrome.tabs.create(getTemporaryCheckInTabCreateOptions(url, options));
  startAutomationHumanVerificationMonitor(tab.id, {
    label: 'temporary-check-in-tab',
    ...options,
    url
  });
  try {
    const tabInfo = await ensureTabPageReady(tab.id, url, timeout);
    tabInfo._autoCreated = true;
    return tabInfo;
  } catch (e) {
    await closeTabQuietly(tab.id);
    throw e;
  }
}

function createSiteTabSession() {
  let tabId = null;
  return {
    owns(id) {
      return Boolean(tabId && id && tabId === id);
    },
    async open(url, timeout = 15000, options = {}) {
      if (!tabId) {
        const tab = await createTemporaryBackgroundTab(url, timeout, options);
        tabId = tab.id;
        return tab;
      }

      try {
        await chrome.tabs.get(tabId);
      } catch (e) {
        tabId = null;
        const tab = await createTemporaryBackgroundTab(url, timeout, options);
        tabId = tab.id;
        return tab;
      }

      try {
        startAutomationHumanVerificationMonitor(tabId, {
          label: 'site-tab-session',
          ...options,
          url
        });
        await chrome.tabs.update(tabId, { url, active: options.active === true });
        const tabInfo = await ensureTabPageReady(tabId, url, timeout);
        tabInfo._autoCreated = true;
        return tabInfo;
      } catch (e) {
        await closeTabQuietly(tabId);
        tabId = null;
        throw e;
      }
    },
    async close() {
      if (!tabId) return;
      const id = tabId;
      tabId = null;
      await closeTabQuietly(id);
    }
  };
}

async function openSiteSessionTab(tabSession, url, timeout = 15000, options = {}) {
  if (tabSession) {
    return tabSession.open(url, timeout, options);
  }
  return createTemporaryBackgroundTab(url, timeout, options);
}

async function closeTabUnlessInSession(tabId, tabSession = null) {
  if (!tabId) return;
  if (tabSession?.owns(tabId)) return;
  await closeTabQuietly(tabId);
}

async function closeTabQuietly(tabId) {
  if (!tabId) return;
  stopAutomationHumanVerificationMonitor(tabId);
  try { await chrome.tabs.remove(tabId); } catch (e) {}
}

// 发送通知
// 发送单个站点签到结果通知
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAutoSignTime() {
  const data = await chrome.storage.local.get('autoSignTime');
  return isValidAutoSignTime(data.autoSignTime) ? data.autoSignTime : GLOBAL_CONFIG.autoSignTime;
}

async function scheduleDailyCheckIn(time) {
  const autoSignTime = isValidAutoSignTime(time) ? time : await getAutoSignTime();
  const nextRun = getNextCheckInTimeFor(autoSignTime);

  await chrome.alarms.clear(DAILY_CHECK_IN_ALARM);
  await chrome.alarms.create(DAILY_CHECK_IN_ALARM, {
    when: nextRun,
    periodInMinutes: 24 * 60
  });

  console.log(`每日签到时间已设置为 ${autoSignTime}`);
  return autoSignTime;
}
