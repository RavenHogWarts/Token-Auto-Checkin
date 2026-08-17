/**
 * Popup 入口逻辑（vanilla TS + DOM）。
 * - 站点 CRUD / 排序：直接读写 storage（loadProfiles / saveProfiles）。
 * - 手动签到 / 重试 / 取消 / 状态 / 每日时间 / 人工兜底：走类型化消息到 background。
 */
import { browser } from '#imports';
import type {
  CheckinResponse,
  CheckinResults,
  CheckinRunState,
  Message,
  StatusResponse,
} from '../../domain/messages';
import { idleRunState } from '../../domain/messages';
import type { CheckinResult, CheckinStatus } from '../../domain/checkin-result';
import type { SitePreset, SiteProfile } from '../../domain/site-profile';
import { siteIdFromDomain } from '../../domain/presets';
import {
  clearPendingPick,
  getFocusHumanVerificationWindow,
  getPendingPick,
  loadProfiles,
  saveProfiles,
  setFocusHumanVerificationWindow,
} from '../../services/storage';
import { isValidAutoSignTime } from '../../shared/time';
import { clearLogs, getLogs, RUN_LOG_KEY, type LogEntry } from '../../services/run-log';
import { openProfileDialog } from './profile-editor';

/** 每日签到时间保存消息的响应（domain 未强类型化，这里按 background 约定描述）。 */
interface AutoSignTimeResponse {
  success: boolean;
  autoSignTime?: string;
  error?: string;
}

const PRESET_LABELS: Record<SitePreset, string> = {
  newapi: 'NewAPI',
  'newapi-profile': 'NewAPI 个人资料',
  sub2api: 'Sub2API',
  zenapi: 'ZenAPI',
  custom: '自定义',
};

// ---- 模块状态 --------------------------------------------------------------
let currentRunState: CheckinRunState = idleRunState();
let latestResults: CheckinResults = {};
let latestLastCheckInTime: string | null = null;
let enabledSiteCount = 0;
let addingSite = false;
let draggedItem: HTMLElement | null = null;
let dragChangedOrder = false;

// ---- 通用工具 --------------------------------------------------------------
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup: 缺少 DOM 元素 #${id}`);
  return node as T;
}

async function sendMessage<T>(msg: Message): Promise<T> {
  return (await browser.runtime.sendMessage(msg)) as T;
}

function isRunning(state: CheckinRunState): boolean {
  return state.running === true;
}

function statusView(status: CheckinStatus | undefined): { className: string; text: string } {
  switch (status) {
    case 'success':
      return { className: 'success', text: '成功' };
    case 'already':
      return { className: 'already', text: '已签' };
    case 'checking':
      return { className: 'checking', text: '签到中' };
    case 'invalid':
      return { className: 'invalid', text: '失效' };
    case 'needs-human':
      return { className: 'needs-human', text: '待人工' };
    case 'failed':
      return { className: 'failed', text: '失败' };
    default:
      return { className: 'pending', text: '待签' };
  }
}

function canRetryStatus(status: CheckinStatus | undefined): boolean {
  return status === undefined || status === 'failed' || status === 'invalid';
}

function formatDateTime(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${h}:${min}`;
}
// ---- 状态展示 --------------------------------------------------------------
function updateStats(): void {
  const vals = Object.values(latestResults);
  el('successCount').textContent = String(vals.filter((r) => r.status === 'success').length);
  el('alreadyCount').textContent = String(vals.filter((r) => r.status === 'already').length);
  el('failedCount').textContent = String(
    vals.filter((r) => r.status === 'failed' || r.status === 'invalid').length,
  );
}

function updateLastCheck(): void {
  const node = el('lastCheck');
  node.textContent = latestLastCheckInTime
    ? `上次签到: ${formatDateTime(new Date(latestLastCheckInTime))}`
    : '暂无签到记录';
}

function setAutoSignTimeDisplay(time: string): void {
  if (!isValidAutoSignTime(time)) return;
  el<HTMLInputElement>('autoSignTime').value = time;
  el('autoSignTimeLabel').textContent = time;
}

function setHumanFocusToggle(enabled: boolean): void {
  el<HTMLInputElement>('humanFocusToggle').checked = enabled === true;
}

function updateCheckInButtonState(): void {
  const btn = el<HTMLButtonElement>('checkInBtn');
  const btnText = el('btnText');
  const spinner = el('btnSpinner');
  const running = isRunning(currentRunState);
  const cancelling = running && currentRunState.cancelling === true;

  btn.disabled = cancelling || (!running && enabledSiteCount === 0);
  btnText.textContent = cancelling
    ? '正在终止...'
    : running
      ? '签到中，点击终止'
      : '立即签到';
  spinner.classList.toggle('active', running);
  btn.title = cancelling
    ? '正在终止当前签到任务'
    : running
      ? '点击终止当前签到任务'
      : enabledSiteCount > 0
        ? ''
        : '请先添加并启用至少一个站点';
}
// ---- 站点列表渲染 ----------------------------------------------------------
async function renderSites(): Promise<void> {
  const profiles = await loadProfiles();
  enabledSiteCount = profiles.filter((p) => p.enabled !== false).length;
  el('totalSites').textContent = String(enabledSiteCount);
  updateCheckInButtonState();
  closeActionMenu();

  const list = el('sitesList');
  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无站点，添加后即可开始签到';
    list.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  profiles.forEach((profile) => fragment.appendChild(buildSiteItem(profile)));
  list.replaceChildren(fragment);
}

function buildSiteItem(profile: SiteProfile): HTMLElement {
  const enabled = profile.enabled !== false;
  const result: CheckinResult | undefined = latestResults[profile.id];

  const item = document.createElement('div');
  item.className = 'site-item';
  item.dataset.siteId = profile.id;
  if (!enabled) item.style.opacity = '0.5';
  item.addEventListener('dragover', onDragOver);
  item.addEventListener('drop', onDrop);

  // 拖动手柄
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.draggable = true;
  handle.textContent = '⠿';
  handle.title = '拖动排序';
  handle.setAttribute('aria-label', `拖动 ${profile.name} 排序`);
  handle.addEventListener('dragstart', () => onDragStart(item));
  handle.addEventListener('dragend', onDragEnd);

  // 启用/禁用
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'toggle';
  toggle.checked = enabled;
  toggle.title = enabled ? '点击禁用' : '点击启用';
  toggle.addEventListener('change', () => void toggleSite(profile.id, toggle.checked));

  // 预设/策略标签
  const tag = document.createElement('span');
  const isVisit = profile.checkin.strategy === 'visit';
  tag.className = isVisit ? 'site-tag visit' : 'site-tag';
  tag.textContent = isVisit ? '仅访问' : PRESET_LABELS[profile.preset];
  tag.title = isVisit ? '仅访问站点（打开页面视为完成）' : `站点类型：${PRESET_LABELS[profile.preset]}`;

  // 站点名（点击打开签到页）
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'site-name site-link';
  name.textContent = profile.name;
  name.title = `打开 ${profile.checkin.pageUrl}`;
  name.addEventListener('click', () => {
    void browser.tabs.create({ url: profile.checkin.pageUrl, active: false });
  });
  // 余额
  let balance: HTMLElement | null = null;
  if (result?.balance) {
    balance = document.createElement('span');
    balance.className = 'site-balance';
    balance.textContent = result.balance;
    balance.title = `余额: ${result.balance}`;
  }

  // 待人工兜底：去完成
  let cta: HTMLElement | null = null;
  if (enabled && result?.status === 'needs-human') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-cta';
    button.textContent = '去完成';
    button.title = result.message ? `${result.message}，点击去手动完成` : '点击去手动完成';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void sendMessage<CheckinResponse>({ type: 'site/activate-manual-tab', siteId: profile.id });
    });
    cta = button;
  }

  // 状态胶囊（失败 / 失效 / 无结果可点击重试）
  const view = statusView(result?.status);
  const canRetry = enabled && canRetryStatus(result?.status);
  const status = document.createElement(canRetry ? 'button' : 'span');
  status.className = `site-status ${result ? view.className : 'pending'}`;
  status.textContent = result ? view.text : enabled ? '待签' : '禁用';
  if (canRetry) {
    (status as HTMLButtonElement).type = 'button';
    status.classList.add('retryable');
    status.title = result?.message ? `${result.message}，点击重试` : '点击签到该站点';
    status.addEventListener('click', () => void retrySite(profile.id));
  } else if (result?.message) {
    status.title = result.message;
  }

  // 更多操作菜单
  const actions = document.createElement('button');
  actions.type = 'button';
  actions.className = 'site-actions-button';
  actions.title = '更多操作';
  actions.setAttribute('aria-label', `${profile.name} 更多操作`);
  const icon = document.createElement('span');
  icon.className = 'site-actions-icon';
  icon.setAttribute('aria-hidden', 'true');
  actions.appendChild(icon);
  actions.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleActionMenu(profile, actions);
  });

  item.append(handle, toggle, tag, name);
  if (balance) item.appendChild(balance);
  if (cta) item.appendChild(cta);
  item.append(status, actions);
  return item;
}
// ---- 拖拽排序 --------------------------------------------------------------
function onDragStart(item: HTMLElement): void {
  draggedItem = item;
  dragChangedOrder = false;
  item.classList.add('dragging');
}

function onDragOver(event: DragEvent): void {
  if (!draggedItem) return;
  const target = event.currentTarget as HTMLElement | null;
  if (!target || target === draggedItem) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  const rect = target.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  const parent = target.parentNode;
  if (!parent) return;

  if (insertAfter) {
    if (target.nextSibling !== draggedItem) {
      parent.insertBefore(draggedItem, target.nextSibling);
      dragChangedOrder = true;
    }
  } else if (target.previousSibling !== draggedItem) {
    parent.insertBefore(draggedItem, target);
    dragChangedOrder = true;
  }
}

function onDrop(event: DragEvent): void {
  if (draggedItem) event.preventDefault();
}

async function onDragEnd(): Promise<void> {
  const item = draggedItem;
  const persist = dragChangedOrder;
  draggedItem = null;
  dragChangedOrder = false;
  item?.classList.remove('dragging');
  if (persist) await persistOrderFromDom();
}

async function persistOrderFromDom(): Promise<void> {
  const orderedIds = Array.from(document.querySelectorAll<HTMLElement>('#sitesList .site-item'))
    .map((node) => node.dataset.siteId)
    .filter((id): id is string => Boolean(id));
  const profiles = await loadProfiles();
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const reordered: SiteProfile[] = [];
  orderedIds.forEach((id) => {
    const profile = byId.get(id);
    if (profile) {
      reordered.push(profile);
      byId.delete(id);
    }
  });
  byId.forEach((profile) => reordered.push(profile));
  await saveProfiles(reordered);
}

// ---- 站点启用切换 ----------------------------------------------------------
async function toggleSite(siteId: string, enabled: boolean): Promise<void> {
  const profiles = await loadProfiles();
  const next = profiles.map((p) => (p.id === siteId ? { ...p, enabled } : p));
  await saveProfiles(next);
}
// ---- 更多操作菜单 ----------------------------------------------------------
interface ActionMenuState {
  siteId: string;
  menu: HTMLElement;
  anchor: HTMLElement;
}
let openMenu: ActionMenuState | null = null;

function closeActionMenu(): void {
  openMenu?.menu.remove();
  openMenu = null;
}

function toggleActionMenu(profile: SiteProfile, anchor: HTMLElement): void {
  if (openMenu?.siteId === profile.id) {
    closeActionMenu();
    return;
  }
  closeActionMenu();

  const menu = document.createElement('div');
  menu.className = 'site-actions-menu';
  menu.setAttribute('role', 'menu');

  const checkin = document.createElement('button');
  checkin.type = 'button';
  checkin.className = 'site-actions-menu-item';
  checkin.textContent = '立即签到';
  checkin.setAttribute('role', 'menuitem');
  checkin.disabled = profile.enabled === false;
  checkin.title = profile.enabled === false ? '请先启用站点' : '仅对该站点重新签到';
  checkin.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenu();
    void retrySite(profile.id);
  });

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'site-actions-menu-item';
  edit.textContent = '修改';
  edit.setAttribute('role', 'menuitem');
  edit.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenu();
    void editSite(profile.id);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'site-actions-menu-item danger';
  remove.textContent = '删除';
  remove.setAttribute('role', 'menuitem');
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenu();
    void deleteSite(profile.id);
  });

  menu.append(checkin, edit, remove);
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuWidth = Math.max(menu.offsetWidth, 112);
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
  const top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  openMenu = { siteId: profile.id, menu, anchor };
}
// ---- 轻量对话框（复用 reference 的 popup-dialog 样式） ----------------------
interface DialogButton {
  text: string;
  value: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

function mountBackdrop(dialog: HTMLElement, onDismiss: () => void): {
  backdrop: HTMLElement;
  teardown: () => void;
} {
  const backdrop = document.createElement('div');
  backdrop.className = 'popup-dialog-backdrop';
  backdrop.appendChild(dialog);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onDismiss();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onDismiss();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  const teardown = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    backdrop.classList.add('is-closing');
    window.setTimeout(() => backdrop.remove(), 160);
  };
  return { backdrop, teardown };
}

function choiceDialog(opts: {
  title: string;
  message?: string;
  buttons: DialogButton[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'popup-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.className = 'popup-dialog-title';
    title.textContent = opts.title;
    dialog.appendChild(title);

    if (opts.message) {
      const msg = document.createElement('p');
      msg.className = 'popup-dialog-message';
      msg.textContent = opts.message;
      dialog.appendChild(msg);
    }

    const actions = document.createElement('div');
    actions.className = 'popup-dialog-actions';
    dialog.appendChild(actions);

    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      teardown();
      resolve(value);
    };
    const { teardown } = mountBackdrop(dialog, () => settle(null));

    opts.buttons.forEach((b) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `popup-dialog-button ${b.variant ?? 'secondary'}`;
      button.textContent = b.text;
      button.addEventListener('click', () => settle(b.value));
      actions.appendChild(button);
    });
  });
}
// ---- 站点增删改 ------------------------------------------------------------
async function addSite(): Promise<void> {
  if (addingSite) return;
  addingSite = true;
  try {
    const profiles = await loadProfiles();
    const created = await openProfileDialog(blankProfile(profiles.length), 'add');
    if (!created) return;
    if (profiles.some((p) => p.domain === created.domain)) {
      window.alert('该站点已存在');
      return;
    }
    await saveProfiles([...profiles, created]);
  } finally {
    addingSite = false;
  }
}

function blankProfile(order: number): SiteProfile {
  return {
    id: '',
    domain: '',
    name: '',
    enabled: true,
    order,
    preset: 'newapi',
    auth: { strategy: 'session-reuse', oauthProvider: 'linuxdo' },
    checkin: { strategy: 'api', pageUrl: '' },
  };
}

/** 点选返回后恢复编辑：把已点选的选择器并入草稿，重新打开编辑器 */
async function resumePendingPick(): Promise<void> {
  const pick = await getPendingPick();
  if (!pick) return;
  await clearPendingPick();
  if (!pick.results.length) return;

  const draft = pick.draft;
  draft.checkin.click = draft.checkin.click ?? {};
  const cur = draft.checkin.click[pick.field] ?? [];
  draft.checkin.click[pick.field] = [...cur, ...pick.results];

  const edited = await openProfileDialog(draft, pick.mode, { openAdvanced: true });
  if (!edited) return;
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.id === edited.id);
  if (idx >= 0) {
    profiles[idx] = edited;
    await saveProfiles(profiles);
  } else {
    await saveProfiles([...profiles, edited]);
  }
}

async function editSite(siteId: string): Promise<void> {
  const profiles = await loadProfiles();
  const profile = profiles.find((p) => p.id === siteId);
  if (!profile) return;

  const edited = await openProfileDialog(profile, 'edit');
  if (!edited) return;

  // 域名变化会改变 id：校验重复
  if (edited.id !== profile.id && profiles.some((p) => p.id === edited.id)) {
    window.alert('该站点域名与已有站点重复');
    return;
  }
  const next = profiles.map((p) => (p.id === siteId ? edited : p));
  await saveProfiles(next);
}

async function deleteSite(siteId: string): Promise<void> {
  const profiles = await loadProfiles();
  const profile = profiles.find((p) => p.id === siteId);
  if (!profile) return;

  const choice = await choiceDialog({
    title: '删除站点',
    message: `确定删除 ${profile.name}？`,
    buttons: [
      { text: '取消', value: 'cancel', variant: 'secondary' },
      { text: '删除', value: 'confirm', variant: 'danger' },
    ],
  });
  if (choice !== 'confirm') return;

  await saveProfiles(profiles.filter((p) => p.id !== siteId));
}
// ---- 签到 / 重试 / 取消 -----------------------------------------------------
function applyCheckinResponse(resp: CheckinResponse | undefined): void {
  if (!resp) return;
  if (resp.results) {
    latestResults = resp.results;
    updateStats();
    void renderSites();
  }
  currentRunState = resp.runState ?? idleRunState();
  if (!resp.running) {
    latestLastCheckInTime = new Date().toISOString();
    updateLastCheck();
  }
  updateCheckInButtonState();
}

async function onCheckInClick(): Promise<void> {
  if (isRunning(currentRunState)) {
    const btnText = el('btnText');
    el<HTMLButtonElement>('checkInBtn').disabled = true;
    btnText.textContent = '正在终止...';
    try {
      const resp = await sendMessage<CheckinResponse>({ type: 'checkin/cancel' });
      applyCheckinResponse(resp);
    } catch (error) {
      window.alert('终止失败: ' + errorMessage(error));
    } finally {
      updateCheckInButtonState();
    }
    return;
  }

  if (enabledSiteCount === 0) return;
  currentRunState = { ...idleRunState(), running: true, source: 'manual' };
  updateCheckInButtonState();
  try {
    const resp = await sendMessage<CheckinResponse>({ type: 'checkin/manual' });
    if (resp && resp.success === false) throw new Error(resp.error || '签到失败');
    applyCheckinResponse(resp);
  } catch (error) {
    window.alert('签到失败: ' + errorMessage(error));
    currentRunState = idleRunState();
    updateCheckInButtonState();
  }
}

async function retrySite(siteId: string): Promise<void> {
  if (isRunning(currentRunState)) return;
  latestResults = { ...latestResults, [siteId]: { status: 'checking', message: '签到中' } };
  updateStats();
  await renderSites();
  try {
    const resp = await sendMessage<CheckinResponse>({ type: 'checkin/retry-site', siteId });
    if (resp && resp.success === false) throw new Error(resp.error || '重试失败');
    applyCheckinResponse(resp);
  } catch (error) {
    window.alert('重试失败: ' + errorMessage(error));
    await refreshFromStatus();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
// ---- 每日签到时间 / 人工兜底开关 -------------------------------------------
async function saveAutoSignTime(): Promise<void> {
  const input = el<HTMLInputElement>('autoSignTime');
  const status = el('timeStatus');
  const btn = el<HTMLButtonElement>('saveTimeBtn');
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
    const resp = await sendMessage<AutoSignTimeResponse>({
      type: 'settings/update-auto-sign-time',
      time,
    });
    if (!resp?.success) throw new Error(resp?.error || '保存失败');
    const saved = resp.autoSignTime ?? time;
    setAutoSignTimeDisplay(saved);
    status.textContent = `已保存为 ${saved}`;
  } catch (error) {
    status.classList.add('error');
    status.textContent = errorMessage(error);
  } finally {
    btn.disabled = false;
  }
}

async function onHumanFocusToggle(event: Event): Promise<void> {
  const checked = (event.target as HTMLInputElement).checked === true;
  await setFocusHumanVerificationWindow(checked);
}

// ---- 导入 / 导出 ------------------------------------------------------------
async function exportConfig(): Promise<void> {
  const profiles = await loadProfiles();
  const focusHumanVerificationWindow = await getFocusHumanVerificationWindow();
  const autoSignTimeInput = el<HTMLInputElement>('autoSignTime').value;
  const autoSignTime = isValidAutoSignTime(autoSignTimeInput) ? autoSignTimeInput : '09:00';

  const config = { version: 2, profiles, autoSignTime, focusHumanVerificationWindow };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `checkin-sites-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function normalizeImportedProfiles(raw: unknown[]): SiteProfile[] {
  const result: SiteProfile[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<SiteProfile>;
    const domain = typeof candidate.domain === 'string' ? candidate.domain.trim().toLowerCase() : '';
    if (!domain || !candidate.checkin || typeof candidate.checkin.pageUrl !== 'string') continue;
    result.push({
      ...(candidate as SiteProfile),
      domain,
      id: candidate.id || siteIdFromDomain(domain),
    });
  }
  return result;
}

async function importConfig(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const config = (parsed ?? {}) as { profiles?: unknown; autoSignTime?: unknown; focusHumanVerificationWindow?: unknown };
    if (!Array.isArray(config.profiles)) {
      window.alert('配置文件格式错误：缺少 profiles 数组');
      return;
    }
    const imported = normalizeImportedProfiles(config.profiles);
    if (imported.length === 0) {
      window.alert('配置文件中没有有效的站点');
      return;
    }

    const existing = await loadProfiles();
    let mode: 'replace' | 'merge' = 'replace';
    if (existing.length > 0) {
      const choice = await choiceDialog({
        title: '导入方式',
        message: `当前有 ${existing.length} 个站点，导入 ${imported.length} 个站点，请选择方式。`,
        buttons: [
          { text: '取消', value: 'cancel', variant: 'secondary' },
          { text: '合并', value: 'merge', variant: 'primary' },
          { text: '覆盖', value: 'replace', variant: 'danger' },
        ],
      });
      if (choice !== 'replace' && choice !== 'merge') return;
      mode = choice;
    }

    let finalProfiles: SiteProfile[];
    if (mode === 'replace') {
      finalProfiles = imported;
    } else {
      const seen = new Set(existing.map((p) => p.domain));
      const additions = imported.filter((p) => !seen.has(p.domain));
      if (additions.length === 0) {
        window.alert('所有站点都已存在，无需导入');
        return;
      }
      finalProfiles = [...existing, ...additions];
      window.alert(`成功导入 ${additions.length} 个新站点`);
    }
    await saveProfiles(finalProfiles);

    if (isValidAutoSignTime(config.autoSignTime)) {
      await sendMessage<AutoSignTimeResponse>({
        type: 'settings/update-auto-sign-time',
        time: config.autoSignTime,
      });
      setAutoSignTimeDisplay(config.autoSignTime);
    }
    if (typeof config.focusHumanVerificationWindow === 'boolean') {
      await setFocusHumanVerificationWindow(config.focusHumanVerificationWindow);
      setHumanFocusToggle(config.focusHumanVerificationWindow);
    }
  } catch (error) {
    window.alert('导入失败: ' + errorMessage(error));
  } finally {
    target.value = '';
  }
}
// ---- 初始化 ----------------------------------------------------------------
async function refreshFromStatus(): Promise<void> {
  let status: StatusResponse | undefined;
  try {
    status = await sendMessage<StatusResponse | undefined>({ type: 'status/get' });
  } catch {
    status = undefined;
  }
  if (status) {
    latestResults = status.checkInResults ?? {};
    currentRunState = status.runState ?? idleRunState();
    latestLastCheckInTime = status.lastCheckInTime ?? null;
    setAutoSignTimeDisplay(status.autoSignTime);
    setHumanFocusToggle(status.focusHumanVerificationWindow);
  }
  updateStats();
  updateLastCheck();
  await renderSites();
}

function wireEvents(): void {
  el('checkInBtn').addEventListener('click', () => void onCheckInClick());
  el('showAddBtn').addEventListener('click', () => void addSite());
  el('exportBtn').addEventListener('click', () => void exportConfig());
  el('importBtn').addEventListener('click', () => el<HTMLInputElement>('importFile').click());
  el<HTMLInputElement>('importFile').addEventListener('change', (e) => void importConfig(e));
  el('saveTimeBtn').addEventListener('click', () => void saveAutoSignTime());
  el<HTMLInputElement>('humanFocusToggle').addEventListener('change', (e) => void onHumanFocusToggle(e));

  el('tabSites').addEventListener('click', () => switchTab('sites'));
  el('tabLogs').addEventListener('click', () => switchTab('logs'));
  el('clearLogsBtn').addEventListener('click', () => void clearLogs().then(() => renderLogs()));

  document.addEventListener('click', (event) => {
    if (!openMenu) return;
    const node = event.target as Node;
    if (openMenu.menu.contains(node) || openMenu.anchor.contains(node)) return;
    closeActionMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeActionMenu();
  });
  window.addEventListener('scroll', () => closeActionMenu(), true);
}

function wireStorageListener(): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.checkInResults) {
      latestResults = (changes.checkInResults.newValue as CheckinResults | undefined) ?? {};
      updateStats();
      void renderSites();
    }
    if (changes.siteProfiles) void renderSites();
    if (changes.runState) {
      currentRunState = (changes.runState.newValue as CheckinRunState | undefined) ?? idleRunState();
      updateCheckInButtonState();
    }
    if (changes.lastCheckInTime) {
      latestLastCheckInTime = (changes.lastCheckInTime.newValue as string | null | undefined) ?? null;
      updateLastCheck();
      updateCheckInButtonState();
    }
    if (changes.focusHumanVerificationWindow) {
      setHumanFocusToggle(changes.focusHumanVerificationWindow.newValue === true);
    }
    if (changes[RUN_LOG_KEY]) void renderLogs();
  });
}

// ---- 运行日志标签 ----------------------------------------------------------
function switchTab(tab: 'sites' | 'logs'): void {
  const isLogs = tab === 'logs';
  el('panel-sites').hidden = isLogs;
  el('panel-logs').hidden = !isLogs;
  el('tabSites').classList.toggle('active', !isLogs);
  el('tabLogs').classList.toggle('active', isLogs);
  if (isLogs) void renderLogs();
}

const LOG_LEVEL_TEXT: Record<LogEntry['level'], string> = {
  info: 'ℹ',
  success: '✓',
  warn: '!',
  error: '✗',
};

function formatLogTime(t: number): string {
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function renderLogs(): Promise<void> {
  const logs = await getLogs();
  const list = el('logList');
  el('logCount').textContent = logs.length ? `共 ${logs.length} 条` : '暂无日志';
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = '暂无运行日志';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const entry of [...logs].reverse()) {
    const row = document.createElement('div');
    row.className = `log-entry log-${entry.level}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatLogTime(entry.t);
    const icon = document.createElement('span');
    icon.className = 'log-icon';
    icon.textContent = LOG_LEVEL_TEXT[entry.level] ?? 'ℹ';
    const msg = document.createElement('span');
    msg.className = 'log-msg';
    const label = entry.site || entry.scope || '';
    msg.textContent = label ? `${label} · ${entry.msg}` : entry.msg;
    row.append(time, icon, msg);
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
}

async function init(): Promise<void> {
  wireEvents();
  wireStorageListener();
  try {
    setHumanFocusToggle(await getFocusHumanVerificationWindow());
  } catch {
    /* 忽略：由 status 兜底 */
  }
  await refreshFromStatus();
  await renderLogs();
  await resumePendingPick();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}