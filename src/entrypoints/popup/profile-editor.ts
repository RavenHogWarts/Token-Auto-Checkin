/**
 * 站点档案完整编辑对话框。支持编辑认证策略、签到策略、接口/选择器等全部可配置项，
 * 并按所选策略渐进显示相关字段。自包含（不依赖 main.ts 的对话框实现）。
 */
import { buildSiteProfile, siteIdFromDomain } from '../../domain/presets';
import { OAUTH_PROVIDERS } from '../../domain/oauth-providers';
import type {
  AuthStrategy,
  CheckinStrategy,
  OAuthProvider,
  SitePreset,
  SiteProfile,
} from '../../domain/site-profile';
import { setPendingPick } from '../../services/storage';
import { sendStartPick } from './pick-client';
import { parseSiteInput } from '../../shared/url';

const AUTH_OPTIONS: { value: AuthStrategy; label: string }[] = [
  { value: 'cookie', label: 'cookie · 直接用已有 cookie' },
  { value: 'session-reuse', label: 'session-reuse · 复用登录态，失效才登录' },
  { value: 'token-storage', label: 'token-storage · 读页面 token' },
  { value: 'oauth-linuxdo', label: 'oauth-linuxdo · 走 linux.do 登录' },
  { value: 'force-relogin', label: 'force-relogin · 每次先登出再登录' },
];

const CHECKIN_OPTIONS: { value: CheckinStrategy; label: string }[] = [
  { value: 'api', label: 'api · 调用签到接口' },
  { value: 'visit', label: 'visit · 仅打开页面（cookie 自动签）' },
  { value: 'page-click', label: 'page-click · 页面查找并点击按钮' },
  { value: 'manual-assist', label: 'manual-assist · 前台交我手动完成' },
];

const PRESET_OPTIONS: { value: SitePreset; label: string }[] = [
  { value: 'newapi', label: 'NewAPI' },
  { value: 'sub2api', label: 'Sub2API' },
  { value: 'zenapi', label: 'ZenAPI' },
  { value: 'custom', label: '自定义' },
];

const PROVIDER_OPTIONS: { value: OAuthProvider; label: string }[] = (
  Object.values(OAUTH_PROVIDERS) as { id: OAuthProvider; label: string }[]
).map((p) => ({ value: p.id, label: `${p.label} 登录` }));

function fieldRow(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'editor-field';
  const label = document.createElement('span');
  label.className = 'editor-label';
  label.textContent = labelText;
  wrap.append(label, control);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'editor-hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function makeInput(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'editor-input';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function makeSelect<T extends string>(
  options: { value: T; label: string }[],
  value: T,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'editor-input';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.value === value) el.selected = true;
    select.appendChild(el);
  }
  return select;
}

function makeCheckbox(labelText: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'editor-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const span = document.createElement('span');
  span.textContent = labelText;
  row.append(input, span);
  return { row, input };
}

function makeTextarea(value: string, placeholder = ''): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.className = 'editor-input editor-textarea';
  ta.value = value;
  ta.placeholder = placeholder;
  ta.rows = 3;
  return ta;
}

function toLines(value: string[] | undefined): string {
  return (value ?? []).join('\n');
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function makePickBtn(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'editor-pick-btn';
  b.textContent = '＋ 点选';
  b.title = '在当前页面点击目标元素，自动获取选择器';
  return b;
}

function mountBackdrop(dialog: HTMLElement, onDismiss: () => void): () => void {
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
  return () => {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    backdrop.classList.add('is-closing');
    window.setTimeout(() => backdrop.remove(), 160);
  };
}

/**
 * 打开完整档案编辑器（添加 / 编辑共用）。高级设置默认折叠。
 * 返回编辑后的新 profile；取消返回 null。保留未在表单暴露的字段（如 balance）。
 */
export function openProfileDialog(
  profile: SiteProfile,
  mode: 'add' | 'edit' = 'edit',
  opts: { openAdvanced?: boolean } = {},
): Promise<SiteProfile | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'popup-dialog editor-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.className = 'popup-dialog-title';
    title.textContent = mode === 'add' ? '添加站点' : '编辑站点';
    dialog.appendChild(title);

    // 基础字段
    const nameInput = makeInput(profile.name, '站点名称');
    const pageUrlInput = makeInput(profile.checkin.pageUrl, 'https://example.com/console/personal');
    const presetSelect = makeSelect<SitePreset>(PRESET_OPTIONS, profile.preset);
    const enabled = makeCheckbox('启用该站点', profile.enabled !== false);

    dialog.append(
      fieldRow('站点名称', nameInput),
      fieldRow('签到页地址', pageUrlInput, '用于打开页面、派生站点域名'),
      fieldRow('站点预设', presetSelect, '仅用于快速填充默认接口路径'),
      enabled.row,
    );

    // ---- 高级设置（默认折叠） ----
    const advToggle = document.createElement('button');
    advToggle.type = 'button';
    advToggle.className = 'editor-adv-toggle';
    const advanced = document.createElement('div');
    advanced.className = 'editor-advanced';
    let advOpen = opts.openAdvanced === true || (mode === 'edit' && profile.preset === 'custom');
    const syncAdv = (): void => {
      advanced.style.display = advOpen ? '' : 'none';
      advToggle.textContent = `${advOpen ? '▾' : '▸'} 高级设置（认证 / 签到策略）`;
    };
    advToggle.addEventListener('click', () => {
      advOpen = !advOpen;
      syncAdv();
    });
    dialog.append(advToggle, advanced);

    // 认证策略
    const authSelect = makeSelect<AuthStrategy>(AUTH_OPTIONS, profile.auth.strategy);
    advanced.appendChild(fieldRow('认证策略', authSelect));
    const providerSelect = makeSelect<OAuthProvider>(
      PROVIDER_OPTIONS,
      profile.auth.oauthProvider ?? 'linuxdo',
    );
    advanced.appendChild(
      fieldRow('OAuth 登录方', providerSelect, '重新登录 / OAuth 时点击哪个第三方登录'),
    );
    const tokenKeysInput = makeInput(
      (profile.auth.tokenKeys ?? []).join(', '),
      'user_token, auth_token',
    );
    const tokenKeysRow = fieldRow('Token 键名', tokenKeysInput, '逗号分隔，token-storage 用');
    advanced.appendChild(tokenKeysRow);

    // 签到策略
    const checkinSelect = makeSelect<CheckinStrategy>(CHECKIN_OPTIONS, profile.checkin.strategy);
    advanced.appendChild(fieldRow('签到策略', checkinSelect));

    // 接口配置（api 策略）
    const defaultApi = buildSiteProfile({
      domain: profile.domain,
      preset: profile.preset,
      pageUrl: profile.checkin.pageUrl,
    }).checkin.api;
    const api = profile.checkin.api ?? defaultApi;
    const execUrlInput = makeInput(api?.execUrl ?? '', 'https://a.com/api/user/checkin');
    const methodSelect = makeSelect<'GET' | 'POST'>(
      [
        { value: 'POST', label: 'POST' },
        { value: 'GET', label: 'GET' },
      ],
      api?.method ?? 'POST',
    );
    const queryUrlInput = makeInput(api?.queryUrl ?? '', '（可选）二次核验接口');
    const successOnHttpOk = makeCheckbox('HTTP 2xx 即视为成功', api?.successOnHttpOk === true);
    const apiSection = document.createElement('div');
    apiSection.className = 'editor-section';
    apiSection.append(
      fieldRow('签到接口 URL', execUrlInput),
      fieldRow('请求方法', methodSelect),
      fieldRow('核验接口 URL', queryUrlInput),
      successOnHttpOk.row,
    );
    advanced.appendChild(apiSection);

    // 点击配置（page-click / manual-assist 策略）：有序「点击步骤」列表
    const click = profile.checkin.click ?? {};
    const initialSteps =
      click.steps && click.steps.length
        ? click.steps
        : [...(click.navSteps ?? []), ...(click.selectors ?? [])];
    const textPatternsInput = makeTextarea(toLines(click.textPatterns), '立即签到\nCheck in');
    const keepTab = makeCheckbox('找不到按钮时保留页面并切到前台交我处理', click.keepTabForManual === true);
    const waitInput = makeInput(click.waitTimeoutMs ? String(click.waitTimeoutMs) : '', '20000');

    const stepsList = document.createElement('div');
    stepsList.className = 'editor-steps';
    const stepRows: { row: HTMLElement; input: HTMLInputElement }[] = [];

    const renumber = (): void => {
      stepRows.forEach((e, i) => {
        const idx = e.row.querySelector('.editor-step-idx');
        if (idx) idx.textContent = String(i + 1);
      });
    };
    const addStepRow = (value = ''): void => {
      const row = document.createElement('div');
      row.className = 'editor-step';
      const idxEl = document.createElement('span');
      idxEl.className = 'editor-step-idx';
      const input = makeInput(value, '#选择器 或 文案，如 个人资料');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'editor-step-del';
      del.textContent = '✕';
      del.title = '删除该步骤';
      row.append(idxEl, input, del);
      const entry = { row, input };
      stepRows.push(entry);
      del.addEventListener('click', () => {
        const i = stepRows.indexOf(entry);
        if (i >= 0) stepRows.splice(i, 1);
        row.remove();
        renumber();
      });
      stepsList.appendChild(row);
      renumber();
    };
    initialSteps.forEach((s) => addStepRow(s));

    const stepsToolbar = document.createElement('div');
    stepsToolbar.className = 'editor-steps-toolbar';
    const addStepBtn = document.createElement('button');
    addStepBtn.type = 'button';
    addStepBtn.className = 'editor-pick-btn';
    addStepBtn.textContent = '＋ 添加步骤';
    addStepBtn.addEventListener('click', () => addStepRow(''));
    const pickStepBtn = makePickBtn();
    pickStepBtn.textContent = '＋ 点选添加';
    stepsToolbar.append(addStepBtn, pickStepBtn);

    const stepsField = document.createElement('div');
    stepsField.className = 'editor-field';
    const stepsHead = document.createElement('div');
    stepsHead.className = 'editor-field-head';
    const stepsLabel = document.createElement('span');
    stepsLabel.className = 'editor-label';
    stepsLabel.textContent = '点击步骤';
    stepsHead.append(stepsLabel, pickStepBtn);
    const stepsHint = document.createElement('span');
    stepsHint.className = 'editor-hint';
    stepsHint.textContent =
      '在当前页面依次点击每一步；每行先当选择器再当文案。最后一步通常即签到按钮。';
    stepsField.append(stepsHead, stepsList, stepsToolbar, stepsHint);

    const clickSection = document.createElement('div');
    clickSection.className = 'editor-section';
    clickSection.append(
      stepsField,
      fieldRow('备用按钮文案', textPatternsInput, '（可选）无步骤时按文案自动查找签到按钮'),
      keepTab.row,
      fieldRow('等待超时(ms)', waitInput),
    );
    advanced.appendChild(clickSection);

    // 人机验证
    const focusWindow = makeCheckbox(
      '检测到人机验证时把窗口切到前台',
      profile.humanVerification?.focusWindowOnDetect === true,
    );
    advanced.appendChild(focusWindow.row);

    const error = document.createElement('div');
    error.className = 'popup-dialog-error';
    error.hidden = true;
    dialog.appendChild(error);

    const updateVisibility = (): void => {
      tokenKeysRow.style.display = authSelect.value === 'token-storage' ? '' : 'none';
      apiSection.style.display = checkinSelect.value === 'api' ? '' : 'none';
      const isClick = checkinSelect.value === 'page-click' || checkinSelect.value === 'manual-assist';
      clickSection.style.display = isClick ? '' : 'none';
    };
    authSelect.addEventListener('change', updateVisibility);
    checkinSelect.addEventListener('change', updateVisibility);
    updateVisibility();
    syncAdv();

    // 预设切换时，按新预设回填接口/页面/策略默认值（仅覆盖为新默认，避免误删自定义）
    presetSelect.addEventListener('change', () => {
      const preset = presetSelect.value as SitePreset;
      const domainGuess = parseSiteInput(pageUrlInput.value.trim())?.domain || 'example.com';
      const d = buildSiteProfile({ domain: domainGuess, preset });
      authSelect.value = d.auth.strategy;
      checkinSelect.value = d.checkin.strategy;
      tokenKeysInput.value = (d.auth.tokenKeys ?? []).join(', ');
      if (d.checkin.api) {
        execUrlInput.value = d.checkin.api.execUrl;
        methodSelect.value = d.checkin.api.method;
        queryUrlInput.value = d.checkin.api.queryUrl ?? '';
      }
      updateVisibility();
    });

    let settled = false;
    const settle = (value: SiteProfile | null): void => {
      if (settled) return;
      settled = true;
      teardown();
      resolve(value);
    };
    const teardown = mountBackdrop(dialog, () => settle(null));

    const fail = (message: string): null => {
      error.textContent = message;
      error.hidden = false;
      return null;
    };

    const assemble = (domain: string, pageUrl: string, name: string): SiteProfile => {
      const authStrategy = authSelect.value as AuthStrategy;
      const checkinStrategy = checkinSelect.value as CheckinStrategy;
      const tokenKeys = tokenKeysInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const next: SiteProfile = {
        id: siteIdFromDomain(domain),
        domain,
        name,
        enabled: enabled.input.checked,
        order: profile.order,
        preset: presetSelect.value as SitePreset,
        auth: {
          strategy: authStrategy,
          oauthProvider: providerSelect.value as OAuthProvider,
          ...(tokenKeys.length ? { tokenKeys } : {}),
        },
        checkin: { strategy: checkinStrategy, pageUrl },
        ...(focusWindow.input.checked
          ? { humanVerification: { focusWindowOnDetect: true } }
          : {}),
        ...(profile.balance ? { balance: profile.balance } : {}),
      };

      if (checkinStrategy === 'api') {
        let execUrl = execUrlInput.value.trim();
        if ((!execUrl || execUrl.includes(':///')) && domain) {
          execUrl = buildSiteProfile({ domain, preset: next.preset }).checkin.api?.execUrl ?? '';
        }
        next.checkin.api = {
          execUrl,
          method: methodSelect.value as 'GET' | 'POST',
          ...(queryUrlInput.value.trim() ? { queryUrl: queryUrlInput.value.trim() } : {}),
          ...(successOnHttpOk.input.checked ? { successOnHttpOk: true } : {}),
        };
      }
      if (checkinStrategy === 'page-click' || checkinStrategy === 'manual-assist') {
        const steps = stepRows.map((e) => e.input.value.trim()).filter(Boolean);
        const textPatterns = fromLines(textPatternsInput.value);
        const wait = Number(waitInput.value.trim());
        next.checkin.click = {
          ...(steps.length ? { steps } : {}),
          ...(textPatterns.length ? { textPatterns } : {}),
          keepTabForManual: keepTab.input.checked,
          ...(Number.isFinite(wait) && wait > 0 ? { waitTimeoutMs: wait } : {}),
        };
      }
      return next;
    };

    /** 保存用：严格校验 */
    const build = (): SiteProfile | null => {
      const parsed = parseSiteInput(pageUrlInput.value.trim());
      if (!parsed) return fail('请输入有效的签到页地址');
      const domain = parsed.domain;
      const pageUrl = parsed.pageUrl ?? `https://${domain}`;
      const name = nameInput.value.trim() || domain;
      const next = assemble(domain, pageUrl, name);
      if (next.checkin.strategy === 'api' && !next.checkin.api?.execUrl) {
        return fail('api 策略需要填写签到接口 URL');
      }
      return next;
    };

    /** 点选前用：宽松快照，保留用户当前所有输入（不校验） */
    const snapshot = (): SiteProfile => {
      const parsed = parseSiteInput(pageUrlInput.value.trim());
      const domain = parsed?.domain ?? profile.domain ?? '';
      const pageUrl = parsed?.pageUrl ?? pageUrlInput.value.trim() ?? profile.checkin.pageUrl;
      const name = nameInput.value.trim() || domain;
      return assemble(domain, pageUrl, name);
    };

    /** 开启页面点选：保存草稿 → 请求后台打开页面点选（弹窗随后可能关闭） */
    const onStartPick = async (): Promise<void> => {
      const parsed = parseSiteInput(pageUrlInput.value.trim());
      await setPendingPick({
        field: 'steps',
        mode,
        draft: snapshot(),
        results: [],
      });
      // 在当前活动标签页点选；无有效 pageUrl 时也可（后台会用当前页）
      await sendStartPick(parsed?.pageUrl ?? (parsed ? `https://${parsed.domain}` : undefined));
      settle(null);
    };
    pickStepBtn.addEventListener('click', () => void onStartPick());

    const actions = document.createElement('div');
    actions.className = 'popup-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'popup-dialog-button secondary';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => settle(null));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'popup-dialog-button primary';
    save.textContent = '保存';
    save.addEventListener('click', () => {
      const built = build();
      if (built) settle(built);
    });
    actions.append(cancel, save);
    dialog.appendChild(actions);

    requestAnimationFrame(() => nameInput.focus());
  });
}
