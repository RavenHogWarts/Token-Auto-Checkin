let currentRunState = { running: false };
let latestLastCheckInTime = null;
let addingSite = false;
let draggedSiteItem = null;
let siteOrderChangedByDrag = false;
let openSiteActionMenuState = null;
const FOCUS_HUMAN_VERIFICATION_WINDOW_KEY = 'focusHumanVerificationWindow';
const sitesRenderGuard = createLatestRenderGuard();

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadHumanFocusToggleState();
  loadStatus();
  chrome.storage.onChanged.addListener(handleStorageChange);
});

function setupEventListeners() {
  document.getElementById('checkInBtn').addEventListener('click', handleManualCheckIn);
  document.getElementById('showAddBtn').addEventListener('click', () => {
    document.getElementById('addForm').classList.toggle('show');
    document.getElementById('newDomain').focus();
  });
  document.getElementById('confirmAddBtn').addEventListener('click', handleAddSite);
  document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addForm').classList.remove('show');
    resetAddForm();
  });
  document.getElementById('newDomain').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddSite();
  });

  // 导出/导入
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', handleImport);
  document.getElementById('saveTimeBtn').addEventListener('click', handleSaveAutoSignTime);
  document.getElementById('humanFocusToggle').addEventListener('change', handleHumanFocusToggleChange);
  document.addEventListener('click', handleSiteActionMenuDocumentClick);
  document.addEventListener('keydown', handleSiteActionMenuKeyDown);
  window.addEventListener('scroll', () => closeSiteActionMenu(), true);
}

// 加载签到状态
function loadStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response) {
      const results = response.checkInResults || {};
      latestLastCheckInTime = response.lastCheckInTime || null;
      currentRunState = getCheckInRunState({ checkInRunState: response.checkInRunState });
      updateStats(results);
      renderSites(results);
    }
    if (response?.lastCheckInTime) {
      document.getElementById('lastCheck').textContent =
        `上次签到: ${formatDateTime(new Date(response.lastCheckInTime))}`;
    }
    if (response?.autoSignTime) {
      setAutoSignTimeDisplay(response.autoSignTime);
    }
    applyHumanFocusToggleState(response);
  });
}

function handleStorageChange(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes.checkInResults) {
    const results = changes.checkInResults.newValue || {};
    updateStats(results);
    renderSites(results, { preserveScroll: true });
  }

  if (changes.checkInRunState) {
    currentRunState = getCheckInRunState({ checkInRunState: changes.checkInRunState.newValue });
    updateCheckInButtonState();
  }

  if (changes.userSites) {
    renderSites(undefined, { preserveScroll: true });
  }

  if (changes.lastCheckInTime) {
    latestLastCheckInTime = changes.lastCheckInTime.newValue || null;
    if (changes.lastCheckInTime.newValue) {
      document.getElementById('lastCheck').textContent =
        `上次签到: ${formatDateTime(new Date(changes.lastCheckInTime.newValue))}`;
    } else {
      document.getElementById('lastCheck').textContent = '暂无签到记录';
    }
    updateCheckInButtonState();
  }

  if (changes[FOCUS_HUMAN_VERIFICATION_WINDOW_KEY]) {
    applyHumanFocusToggleState({
      [FOCUS_HUMAN_VERIFICATION_WINDOW_KEY]: changes[FOCUS_HUMAN_VERIFICATION_WINDOW_KEY].newValue
    });
  }
}

// 渲染站点列表
async function renderSites(results, { preserveScroll = false } = {}) {
  const renderToken = sitesRenderGuard.begin();
  const scrollContainer = document.scrollingElement || document.documentElement;
  const scrollTop = preserveScroll ? scrollContainer.scrollTop : 0;
  const sites = await loadRawSites();

  // 如果没传 results，从 storage 读取上次结果
  if (!results) {
    const data = await chrome.storage.local.get('checkInResults');
    results = data.checkInResults || {};
  }

  if (!sitesRenderGuard.isCurrent(renderToken)) return;

  const sitesList = document.getElementById('sitesList');
  document.getElementById('totalSites').textContent = sites.filter(s => s.enabled !== false).length;
  updateCheckInButtonState(sites);
  closeSiteActionMenu();

  if (sites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无站点，添加后即可开始签到';
    sitesList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  sites.forEach((site, index) => {
    const siteId = site.domain.replace(/\./g, '_');
    const result = results[siteId];
    const enabled = site.enabled !== false;

    const item = document.createElement('div');
    item.className = 'site-item';
    item.dataset.domain = site.domain;
    if (!enabled) item.style.opacity = '0.5';

    // 拖动手柄
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'drag-handle';
    dragHandle.draggable = true;
    dragHandle.textContent = '⠿';
    dragHandle.title = '拖动排序';
    dragHandle.setAttribute('aria-label', `拖动 ${site.name || site.domain} 排序`);
    dragHandle.addEventListener('dragstart', handleSiteDragStart);
    dragHandle.addEventListener('dragend', handleSiteDragEnd);

    item.addEventListener('dragover', handleSiteDragOver);
    item.addEventListener('drop', handleSiteDrop);

    // 开关
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'toggle';
    toggle.checked = enabled;
    toggle.title = enabled ? '点击禁用' : '点击启用';
    toggle.addEventListener('change', () => toggleSite(index, toggle.checked));

    // 站点名
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'site-name site-link';
    name.textContent = site.name || site.domain;
    name.title = `打开 ${getSitePageUrl(site)}`;
    name.addEventListener('click', () => openSitePage(site));

    // 状态
    const canRetry = enabled && canRetrySiteStatus(result?.status);
    const status = document.createElement(canRetry ? 'button' : 'span');
    status.className = 'site-status';
    if (canRetry) {
      status.type = 'button';
      status.classList.add('retryable');
      status.title = result?.message ? `${result.message}，点击重试` : '点击签到该站点';
      status.addEventListener('click', () => handleRetrySite(siteId));
    }
    if (result) {
      const view = getStatusView(result.status);
      status.classList.add(view.className);
      status.textContent = view.text;
      if (result.message && !canRetry) {
        status.title = result.message;
      }
    } else {
      status.classList.add('pending');
      status.textContent = enabled ? '待签' : '禁用';
    }

    // 模式/类型
    const modeView = getSiteModeView(site);
    const mode = document.createElement('button');
    mode.type = 'button';
    mode.className = 'site-mode';
    if (modeView.className) mode.classList.add(modeView.className);
    mode.textContent = modeView.label;
    mode.title = modeView.title;
    mode.setAttribute('aria-label', `${getSiteDisplayName(site)}：${modeView.title}`);
    mode.addEventListener('click', (event) => {
      event.stopPropagation();
      handleToggleSiteMode(index);
    });

    const balance = document.createElement('span');
    balance.className = 'site-balance';
    if (result?.balance) {
      balance.textContent = result.balance;
      balance.title = `余额: ${result.balance}`;
    }

    const actions = document.createElement('button');
    actions.type = 'button';
    actions.className = 'site-actions-button';
    actions.title = '更多操作';
    actions.setAttribute('aria-label', `${getSiteDisplayName(site)} 更多操作`);
    const actionsIcon = document.createElement('span');
    actionsIcon.className = 'site-actions-icon';
    actionsIcon.setAttribute('aria-hidden', 'true');
    actions.appendChild(actionsIcon);
    actions.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSiteActionMenu(index, actions);
    });

    item.appendChild(dragHandle);
    item.appendChild(toggle);
    item.appendChild(mode);
    item.appendChild(name);
    if (result?.balance) item.appendChild(balance);
    item.appendChild(status);
    item.appendChild(actions);
    fragment.appendChild(item);
  });

  sitesList.replaceChildren(fragment);

  if (preserveScroll) {
    requestAnimationFrame(() => {
      if (sitesRenderGuard.isCurrent(renderToken)) {
        scrollContainer.scrollTop = scrollTop;
      }
    });
  }
}

function handleSiteDragStart(event) {
  const item = event.currentTarget.closest('.site-item');
  if (!item) return;

  draggedSiteItem = item;
  siteOrderChangedByDrag = false;
  item.classList.add('dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.domain || '');
    event.dataTransfer.setDragImage(item, 16, Math.max(8, item.offsetHeight / 2));
  }
}

function handleSiteDragOver(event) {
  if (!draggedSiteItem) return;

  const targetItem = event.currentTarget;
  if (!targetItem || targetItem === draggedSiteItem) return;

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  const rect = targetItem.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  const parent = targetItem.parentNode;

  if (insertAfter) {
    if (targetItem.nextSibling !== draggedSiteItem) {
      parent.insertBefore(draggedSiteItem, targetItem.nextSibling);
      siteOrderChangedByDrag = true;
    }
    return;
  }

  if (targetItem.previousSibling !== draggedSiteItem) {
    parent.insertBefore(draggedSiteItem, targetItem);
    siteOrderChangedByDrag = true;
  }
}

function handleSiteDrop(event) {
  if (draggedSiteItem) {
    event.preventDefault();
  }
}

async function handleSiteDragEnd() {
  const item = draggedSiteItem;
  const shouldPersist = siteOrderChangedByDrag;

  draggedSiteItem = null;
  siteOrderChangedByDrag = false;
  item?.classList.remove('dragging');

  if (shouldPersist) {
    await persistSiteOrderFromDom();
  }
}

async function persistSiteOrderFromDom() {
  const sites = await loadRawSites();
  const orderedSites = reorderSitesByDomains(sites, getCurrentSiteListOrder());
  await saveSitesConfig(orderedSites);
  await renderSites(undefined, { preserveScroll: true });
}

// 更新统计数字
function updateStats(results) {
  const vals = Object.values(results);
  document.getElementById('successCount').textContent = vals.filter(r => r.status === 'success').length;
  document.getElementById('alreadyCount').textContent = vals.filter(r => r.status === 'already').length;
  document.getElementById('failedCount').textContent = vals.filter(r => r.status === 'failed' || r.status === 'invalid').length;
}

function getStatusView(status) {
  if (status === 'success') return { className: 'success', text: '成功' };
  if (status === 'already') return { className: 'already', text: '已签' };
  if (status === 'checking') return { className: 'checking', text: '签到中' };
  if (status === 'invalid') return { className: 'invalid', text: '失效' };
  return { className: 'failed', text: '失败' };
}

function canRetrySiteStatus(status) {
  return !status || status === 'failed' || status === 'invalid';
}

// 添加站点
async function handleAddSite() {
  if (addingSite) return;
  addingSite = true;
  const confirmAddBtn = document.getElementById('confirmAddBtn');
  confirmAddBtn.disabled = true;

  const input = document.getElementById('newDomain');
  const mode = getSelectedSiteMode();
  try {
    const site = parseSiteInput(input.value, mode);

    if (!site) {
      alert('请输入有效的签到页链接，如 c.com/console/personal');
      return;
    }

    const sites = await loadRawSites();
    if (sites.some(s => String(s.domain || '').toLowerCase() === site.domain)) {
      alert('该站点已存在');
      return;
    }

    sites.push(site);
    await saveSitesConfig(sites);

    resetAddForm();
    document.getElementById('addForm').classList.remove('show');
    renderSites();
  } finally {
    addingSite = false;
    confirmAddBtn.disabled = false;
  }
}

function getSelectedSiteMode() {
  return document.getElementById('visitOnly').checked ? 'visit' : 'checkin';
}

function resetAddForm() {
  document.getElementById('newDomain').value = '';
  document.getElementById('visitOnly').checked = false;
}

function openSitePage(site) {
  chrome.tabs.create(getSiteTabCreateOptions(site));
}

// 切换启用/禁用
async function toggleSite(index, enabled) {
  const sites = await loadRawSites();
  if (sites[index]) {
    sites[index].enabled = enabled;
    await saveSitesConfig(sites);
    await renderSites(undefined, { preserveScroll: true });
  }
}

async function handleToggleSiteMode(index) {
  const sites = await loadRawSites();
  const site = sites[index];
  if (!site) return;

  const confirmed = await showPopupConfirm({
    title: '切换站点模式',
    message: buildModeSwitchConfirmationMessage(site),
    confirmText: '切换',
    cancelText: '取消'
  });
  if (!confirmed) return;

  sites[index] = getSwitchedSiteMode(site);
  await saveSitesConfig(sites);
  await renderSites(undefined, { preserveScroll: true });
}

function toggleSiteActionMenu(index, anchor) {
  if (openSiteActionMenuState?.index === index) {
    closeSiteActionMenu();
    return;
  }

  openSiteActionMenu(index, anchor);
}

function openSiteActionMenu(index, anchor) {
  closeSiteActionMenu();

  const menu = document.createElement('div');
  menu.className = 'site-actions-menu';
  menu.setAttribute('role', 'menu');

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'site-actions-menu-item';
  rename.textContent = '修改';
  rename.setAttribute('role', 'menuitem');
  rename.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeSiteActionMenu();
    await editSite(index);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'site-actions-menu-item danger';
  remove.textContent = '删除';
  remove.setAttribute('role', 'menuitem');
  remove.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeSiteActionMenu();
    await removeSite(index);
  });

  menu.appendChild(rename);
  menu.appendChild(remove);
  document.body.appendChild(menu);
  positionSiteActionMenu(menu, anchor);
  openSiteActionMenuState = { index, menu, anchor };
}

function positionSiteActionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = Math.max(menu.offsetWidth, 112);
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
  const top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function closeSiteActionMenu() {
  openSiteActionMenuState?.menu?.remove();
  openSiteActionMenuState = null;
}

function handleSiteActionMenuDocumentClick(event) {
  const menu = openSiteActionMenuState?.menu;
  const anchor = openSiteActionMenuState?.anchor;
  if (!menu) return;
  if (menu.contains(event.target) || anchor?.contains(event.target)) return;
  closeSiteActionMenu();
}

function handleSiteActionMenuKeyDown(event) {
  if (event.key === 'Escape') {
    closeSiteActionMenu();
  }
}

async function editSite(index) {
  const sites = await loadRawSites();
  const site = sites[index];
  if (!site) return;

  const values = await showPopupForm({
    title: '修改',
    fields: [
      {
        name: 'name',
        label: '站点名称',
        defaultValue: getSiteDisplayName(site)
      },
      {
        name: 'pageUrl',
        label: '签到页地址',
        defaultValue: getSitePageUrl(site),
        placeholder: 'https://example.com/console/personal'
      }
    ],
    confirmText: '保存',
    cancelText: '取消',
    validate: formValues => buildEditedSiteConfig(site, formValues, sites, index).error
  });
  if (!values) return;

  const result = buildEditedSiteConfig(site, values, sites, index);
  if (result.error) return;

  sites[index] = result.site;
  await saveSitesConfig(sites);
  await renderSites(undefined, { preserveScroll: true });
}

// 删除站点
async function removeSite(index) {
  const sites = await loadRawSites();
  const site = sites[index];
  if (!site) return;

  const confirmed = await showPopupConfirm({
    title: '删除站点',
    message: `确定删除 ${getSiteDisplayName(site)}？`,
    confirmText: '删除',
    cancelText: '取消',
    danger: true
  });
  if (!confirmed) return;

  sites.splice(index, 1);
  await saveSitesConfig(sites);
  renderSites();
}

function getSiteDisplayName(site) {
  return site.name || site.domain;
}

// 手动签到
async function handleManualCheckIn() {
  const sites = await loadRawSites();
  if (isCheckInRunningState(currentRunState)) {
    await cancelCurrentCheckIn(sites);
    return;
  }

  if (!canStartCheckIn(sites, currentRunState)) {
    updateCheckInButtonState(sites);
    return;
  }

  currentRunState = buildCheckInRunningState({ total: countEnabledSites(sites), source: 'manual' });
  updateCheckInButtonState(sites);
  showLoading();

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'manualCheckIn' }, (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || '签到失败'));
      });
    });

    updateStats(response.results || {});
    renderSites(response.results || {});
    if (!response.running) {
      latestLastCheckInTime = new Date().toISOString();
      document.getElementById('lastCheck').textContent =
        `上次签到: ${formatDateTime(new Date(latestLastCheckInTime))}`;
      updateCheckInButtonState();
    }
  } catch (error) {
    alert('签到失败: ' + error.message);
  } finally {
    const data = await chrome.storage.local.get('checkInRunState');
    currentRunState = getCheckInRunState(data);
    await updateCheckInButtonState();
  }
}

async function cancelCurrentCheckIn(sites) {
  const btn = document.getElementById('checkInBtn');
  const btnText = document.getElementById('btnText');
  btn.disabled = true;
  btnText.textContent = '正在终止...';
  btn.title = '正在终止当前签到任务';

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'cancelCheckIn' }, (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || '终止失败'));
      });
    });

    if (response.runState) {
      currentRunState = getCheckInRunState({ checkInRunState: response.runState });
    }
    if (response.results) {
      updateStats(response.results);
      renderSites(response.results, { preserveScroll: true });
    }
  } catch (error) {
    alert('终止失败: ' + error.message);
  } finally {
    const data = await chrome.storage.local.get('checkInRunState');
    currentRunState = getCheckInRunState(data);
    await updateCheckInButtonState(sites);
  }
}

async function handleRetrySite(siteId) {
  if (!siteId || isCheckInRunningState(currentRunState)) return;

  const data = await chrome.storage.local.get('checkInResults');
  const currentResults = data.checkInResults || {};
  const checkingResults = markSiteChecking(currentResults, siteId);
  updateStats(checkingResults);
  renderSites(checkingResults, { preserveScroll: true });

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'retrySiteCheckIn', siteId }, (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || '重试失败'));
      });
    });

    updateStats(response.results || {});
    renderSites(response.results || {}, { preserveScroll: true });
    if (!response.running) {
      latestLastCheckInTime = new Date().toISOString();
      document.getElementById('lastCheck').textContent =
        `上次签到: ${formatDateTime(new Date(latestLastCheckInTime))}`;
      updateCheckInButtonState();
    }
  } catch (error) {
    alert('重试失败: ' + error.message);
    loadStatus();
  }
}

async function updateCheckInButtonState(sites) {
  const currentSites = sites || await loadRawSites();
  const running = isCheckInRunningState(currentRunState);
  const cancelling = running && currentRunState?.cancelling === true;
  const enabledCount = countEnabledSites(currentSites);
  const btn = document.getElementById('checkInBtn');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  btn.disabled = cancelling || !canClickCheckInButton(currentSites, currentRunState);
  btnText.textContent = cancelling
    ? '正在终止...'
    : (running ? '签到中，点击终止' : getIdleCheckInButtonText(latestLastCheckInTime));
  btnSpinner?.classList.toggle('active', running);
  btn.title = cancelling
    ? '正在终止当前签到任务'
    : running
    ? '点击终止当前签到任务'
    : (enabledCount > 0 ? '' : '请先添加并启用至少一个站点');
}

function showLoading() {
  document.getElementById('sitesList').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>正在签到...</div>
    </div>
  `;
}

function formatDateTime(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${h}:${min}`;
}

async function handleSaveAutoSignTime() {
  const input = document.getElementById('autoSignTime');
  const status = document.getElementById('timeStatus');
  const btn = document.getElementById('saveTimeBtn');
  const time = input.value;

  status.classList.remove('error');
  status.textContent = '';

  if (!isValidAutoSignTime(time)) {
    status.classList.add('error');
    status.textContent = '请选择有效时间';
    return;
  }

  btn.disabled = true;
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'updateAutoSignTime', time }, (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || '保存失败'));
      });
    });

    setAutoSignTimeDisplay(response.autoSignTime);
    status.textContent = `已保存为 ${response.autoSignTime}`;
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    btn.disabled = false;
  }
}

function setAutoSignTimeDisplay(time) {
  document.getElementById('autoSignTime').value = time;
  document.getElementById('autoSignTimeLabel').textContent = time;
}

function setHumanFocusToggle(enabled) {
  const toggle = document.getElementById('humanFocusToggle');
  if (toggle) toggle.checked = enabled === true;
}

async function loadHumanFocusToggleState() {
  const data = await chrome.storage.local.get(FOCUS_HUMAN_VERIFICATION_WINDOW_KEY);
  applyHumanFocusToggleState(data);
}

function applyHumanFocusToggleState(record = {}) {
  const toggle = document.getElementById('humanFocusToggle');
  const currentChecked = toggle?.checked === true;
  setHumanFocusToggle(resolveHumanFocusToggleState(currentChecked, record));
}

async function handleHumanFocusToggleChange(event) {
  await chrome.storage.local.set({
    [FOCUS_HUMAN_VERIFICATION_WINDOW_KEY]: event.target.checked === true
  });
}

// 导出配置
async function handleExport() {
  const sites = await loadRawSites();
  const exportOrder = getCurrentSiteListOrder();
  const displayNamesByDomain = getCurrentSiteDisplayNamesByDomain();
  const { autoSignTime, focusHumanVerificationWindow } = await chrome.storage.local.get([
    'autoSignTime',
    FOCUS_HUMAN_VERIFICATION_WINDOW_KEY
  ]);
  const currentAutoSignTime = isValidAutoSignTime(autoSignTime)
    ? autoSignTime
    : document.getElementById('autoSignTime').value;

  const config = buildExportConfig(sites, currentAutoSignTime, {
    orderedDomains: exportOrder,
    displayNamesByDomain,
    focusHumanVerificationWindow: focusHumanVerificationWindow === true
  });

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `checkin-sites-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function getCurrentSiteListOrder() {
  return Array.from(document.querySelectorAll('#sitesList .site-item'))
    .map(item => item.dataset.domain)
    .filter(Boolean);
}

function getCurrentSiteDisplayNamesByDomain() {
  const names = {};
  for (const item of document.querySelectorAll('#sitesList .site-item')) {
    const domain = item.dataset.domain;
    if (!domain) continue;
    const name = item.querySelector('.site-name')?.textContent?.trim();
    if (name) names[domain] = name;
  }
  return names;
}

// 导入配置
async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const config = JSON.parse(text);

    // 验证配置格式
    if (!config.sites || !Array.isArray(config.sites)) {
      alert('配置文件格式错误');
      return;
    }

    // 验证并兼容旧版站点格式
    const validSites = normalizeImportSites(config.sites);

    if (validSites.length === 0) {
      alert('配置文件中没有有效的站点');
      return;
    }

    const confirmed = await showPopupConfirm({
      title: '导入站点',
      message: `将导入 ${validSites.length} 个站点，是否继续？`,
      confirmText: '继续',
      cancelText: '取消'
    });
    if (!confirmed) {
      return;
    }

    const currentSites = await loadRawSites();
    let importMode = 'replace';
    if (currentSites.length > 0) {
      const importChoice = await showPopupChoice({
        title: '导入方式',
        message: `当前有 ${currentSites.length} 个站点，请选择导入方式。`,
        primaryText: '覆盖',
        secondaryText: '合并',
        primaryVariant: 'danger'
      });
      if (!importChoice) {
        return;
      }
      importMode = importChoice === 'primary' ? 'replace' : 'merge';
    }

    const importResult = buildImportSites(currentSites, validSites, importMode);
    if (!importResult) {
      return;
    }

    let finalSites = importResult;
    if (!Array.isArray(importResult)) {
      finalSites = importResult.sites;
      if (importResult.newCount === 0) {
        alert('所有站点都已存在，无需导入');
        return;
      }
      alert(`成功导入 ${importResult.newCount} 个新站点`);
    }

    await saveSitesConfig(finalSites);

    const importedAutoSignTime = getImportAutoSignTime(config);
    if (importedAutoSignTime) {
      await chrome.runtime.sendMessage({ action: 'updateAutoSignTime', time: importedAutoSignTime });
      setAutoSignTimeDisplay(importedAutoSignTime);
    }

    const importedFocusHumanVerificationWindow = getImportFocusHumanVerificationWindow(config);
    await chrome.storage.local.set({
      [FOCUS_HUMAN_VERIFICATION_WINDOW_KEY]: importedFocusHumanVerificationWindow
    });
    setHumanFocusToggle(importedFocusHumanVerificationWindow);

    renderSites();
  } catch (error) {
    alert('导入失败: ' + error.message);
  } finally {
    // 清空文件选择
    event.target.value = '';
  }
}
