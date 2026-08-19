# 06 · 变更日志（Changelog）

约定：**每次功能更新递增一个 patch 版本**（`x.y.Z` 的 `Z`），并在此登记。版本号需同步三处：
[package.json](package.json) 的 `version`、[wxt.config.ts](wxt.config.ts) 的 `manifest.version`、
弹窗页脚 [index.html](src/entrypoints/popup/index.html) 的 `v…`。

遵循语义化版本：patch = 兼容的修复/小改；minor = 兼容的新功能（可按需升）；major = 破坏性变更。

---

## v1.0.7

**新增「仅记录」站点类型（不参与自动签到）**

- 新增签到策略 **`record-only`** 与同名预设：站点条目保留在列表中便于统一查看，但**不参与**
  批量/定时签到——不打开标签页、不走认证、不发请求、不计入 badge。
  - [presets.ts](src/domain/presets.ts) `PRESET_DEFAULTS['record-only']`（`auth: cookie` 占位、
    `checkin: record-only`，不派生接口配置）。
  - [orchestrator.ts](src/core/orchestrator.ts) `executeAll` 过滤 `record-only` 站点，不纳入总数与
    2 秒间隔；日志按 `info` 级记录。
  - [pipeline.ts](src/core/pipeline.ts) `runSiteCheckin` 在认证阶段前短路，直接返回 `recorded`
    （单站手动重试亦走此路径，不开 tab）。
- 新增签到状态 **`recorded`**（[checkin-result.ts](src/domain/checkin-result.ts) `CheckinStatus`）。
- 弹窗 UI：预设下拉新增「仅记录」、签到策略下拉新增 `record-only` 选项
  （[profile-editor.ts](src/entrypoints/popup/profile-editor.ts)）；站点行展示虚线边「仅记录」标签与
  静态「仅记录」状态胶囊（不可重试）（[main.ts](src/entrypoints/popup/main.ts) +
  [style.css](src/entrypoints/popup/style.css) `.site-tag.record-only` / `.site-status.recorded`）。
- 测试：[domain.test.ts](src/test/domain.test.ts) 新增 `record-only` 预设用例。
- 文档：[README.md](README.md)、[dev/02-方案设计.md](dev/02-方案设计.md) 同步策略/预设表。

## v1.0.6

**彻底登出重登 · GitHub 直连登录 · NewAPI 个人资料签到 · 自动关公告弹窗**

- **force-relogin 重写为「彻底登出」**：新增 [site-logout.ts](src/page/site-logout.ts) `performSiteLogout`，
  在站点标签页内依次执行「官方登出接口（`/api/user/logout`）+ 清 localStorage/sessionStorage 登录态
  （`user`/`token` 等）+ 清站点 cookie」，再走 OAuth 拿全新 session。修复此前**只删 cookie、前端仍据
  `localStorage.user` 判定已登录**导致的「登出不彻底」。（New API/One API 无状态 session：登录态编码在
  session cookie，删 cookie 即失效，故等价于点页面「退出」。）
- **GitHub 重登直连链路**：NewAPI 的 `client_id` 直连快捷路径由「仅 linux.do」泛化为 **provider 驱动**
  （[oauth-providers.ts](src/domain/oauth-providers.ts) 新增 `clientIdStatusKey`/`stateUrl`/`buildAuthorizeUrl`）。
  GitHub 走：`/api/status` 取 `github_client_id` → `GET /api/oauth/state?mode=login` 取 state →
  跳 `github.com/login/oauth/authorize` → 回调 `/api/oauth/{provider}?code=&state=`（**转发完整 query，含
  state**，修复仅传 code 换取失败）。缺 client_id 时回退站点登录页点击。补充 OAuth 分步诊断日志。
- **NewAPI 个人资料签到（新预设 + bearer-sniff 认证）**：新增预设 **`newapi-profile`**（入口 `/profile`、
  `api` 签到 `POST /api/user/checkin`）与认证策略 **`bearer-sniff`**——用 `chrome.webRequest` 观察页面自身
  发往 `/api/*` 的请求，捕获其认证头（`Authorization: Bearer` 或 `New-Api-User`），**兼容 New API rc.23
  （access token 仅在内存）/ rc.21（session cookie）两种模型**，并在标签页内执行签到以带上 Cloudflare
  `cf_clearance`。token 短时有效（约 15 分钟）→ 与 force-relogin 一样**不吃 7 天缓存**。
  见 [capture-headers.ts](src/services/capture-headers.ts) / [bearer-sniff.ts](src/strategies/auth/bearer-sniff.ts)。
- **自动关闭公告/通知弹窗**：[run-page-checkin.ts](src/page/run-page-checkin.ts) 的 `closeOrdinaryDialogs`
  显式点击 Semi/AntD 弹窗关闭 X（`.semi-modal-close` 等）并识别「关闭公告/今日关闭」；
  [click-login.ts](src/page/click-login.ts) 在点登录按钮前先关公告弹窗——**仅限公告/通知类**，
  跳过含登录/授权/人机验证文案的弹窗，绝不误关登录框。

## v1.0.5

**每个站点可从「更多操作」手动重新签到**

- 站点行的更多操作菜单（⋯）新增「立即签到」，对该站点单独触发签到（`checkin/retry-site`），
  不再局限于状态为失败/失效时点状态胶囊。禁用站点该项置灰（提示先启用）。

## v1.0.4

**page-click 改为「有序点击步骤」+ 当前页面点选**

- **点击步骤（steps）**：`checkin.click` 新增 `steps: string[]`（有序）。编辑器把原「按钮选择器 + 导航点击」
  两个文本域合并为一个**步骤列表**：每行一步「点哪里」，带**添加步骤 / 点选添加 / 逐行删除**，
  自动编号。存在 steps 时运行时优先按步骤依次点击并捕获签到响应
  （[run-page-checkin.ts](src/page/run-page-checkin.ts) `runStepsMode`），为空则回退旧的
  selectors/navSteps/内置文案自动识别。编辑旧档案时自动把 navSteps+selectors 预填为步骤。
- **在当前页面点选（不新开页面）**：`startElementPick` 改为优先注入**当前活动标签页**
  （[element-pick.ts](src/services/element-pick.ts)），仅活动页不可用时才用 pageUrl 新开；
  结束时只关闭由本流程新开的页面，用户原页面不动。`site/start-pick` 的 `pageUrl` 改为可选。
- `PickField` 收敛为 `'steps'`；点选返回的每个选择器作为一个新步骤追加。

## v1.0.3

**运行日志改为真实分步日志 + 元素点选器**

- **运行日志（真实每一步）**：`createLogger` 的每条 `log/warn/error` 现在都落库到运行日志
  [logger.ts](src/shared/logger.ts) → [run-log.ts](src/services/run-log.ts)（容量提升到 500 行），
  并按**站点名作用域**分组（orchestrator 为每个站点创建 `createLogger(profile.name)`）。
  [pipeline.ts](src/core/pipeline.ts) 补充分步日志：认证阶段开始/结果、签到阶段开始（策略+页面）、
  人机验证等。日志标签改为等宽终端样式。
- **元素点选器（自动获取选择器）**：编辑器点击步骤旁新增「＋ 点选」。
  点击后注入 [element-picker.ts](src/page/element-picker.ts)，鼠标高亮、
  点击目标元素自动计算稳健 CSS 选择器回传；支持连续多选，Esc/「完成」结束。
  工具条默认置于**底部居中**且**可按住拖动**（含右键），避免遮挡右上角头像等目标元素。
  弹窗切到页面会关闭，故采用「草稿暂存（`pendingPick`）→ 重开弹窗自动回填」流程
  （[storage.ts](src/services/storage.ts) / [element-pick.ts](src/services/element-pick.ts)）。
  **保留手动输入**：步骤仍可逐行手填。
- 新增消息类型 `site/start-pick`、`event/element-picked`、`event/element-pick-done`。

## v1.0.2

**Tab 界面 + 运行日志 + SPA 导航点击**

- **弹窗改为 Tab 模式**：新增「站点」「运行日志」两个标签页。[index.html](src/entrypoints/popup/index.html)
  加入 `.tabs` 导航与两个 `.tab-panel`，[main.ts](src/entrypoints/popup/main.ts) 加 `switchTab`。
- **运行日志**：新增 [run-log.ts](src/services/run-log.ts)（串行队列 + 环形缓冲，最多 200 条）；
  [orchestrator.ts](src/core/orchestrator.ts) 在批量/单站/每站开始与结束时写入高层事件（含状态与余额）。
  日志标签实时展示（订阅 `runLog` storage 变化），可清空。
- **签到前导航点击（navSteps）**：解决「无法直接跳转到签到页、需先点头像→个人资料」等 SPA 场景。
  `checkin.click.navSteps`（每项先当选择器、匹配不到再当可见文案）在
  [run-page-checkin.ts](src/page/run-page-checkin.ts) 中于查找签到按钮前依次点击导航。
  编辑器新增「导航点击」输入框。
- **文档**：[使用文档](docs/使用文档.md) 增补 Tab、运行日志、导航点击与 tabitoken 示例。

## v1.0.1

**多 OAuth 提供方 + 添加即可配置（折叠高级设置）**

- **OAuth 登录方可选 linux.do / GitHub**：新增 `auth.oauthProvider` 字段与 provider 规格表
  [oauth-providers.ts](src/domain/oauth-providers.ts)。「重新登录 / OAuth」不再写死 linux.do——
  登录按钮文案、第三方授权页 host、登录态 cookie 域名都按 provider 切换。
  - 站点登录页通用入口 `siteLoginPageOAuth` 改为 provider 无关；NewAPI 的 `client_id` 直连快捷路径
    仅在 provider=linuxdo 时启用，其余走登录页点击流程。
  - 页面注入函数 `clickSiteLinuxDoLogin` → `clickSiteOAuthLogin`，接收登录按钮匹配正则源。
  - NewAPI 回调改为 `/api/oauth/{provider}?code=`。
- **添加流程重构**：取消「先快速添加、再修改」。点「添加站点」直接打开**完整档案编辑器**，
  内含默认折叠的「高级设置」（认证策略 / OAuth 登录方 / 签到策略 / 接口 / 选择器 / 人机验证）。
  添加与编辑共用 `openProfileDialog(profile, mode)`。
  - 移除内联快速添加表单（`#addForm` 等）。
  - 预设切换时按新预设回填接口/策略默认值；站点名留空时默认用域名。
- **文档**：[使用文档](docs/使用文档.md) 同步「OAuth 登录方」「添加即配置」说明。

## v1.0.0

- 首个 TypeScript + WXT 重写版本：声明式站点档案（SiteProfile）+ 认证/签到双维度策略插件，
  覆盖 NewAPI / Sub2API / ZenAPI 接口签到、页面点击兜底、仅访问、强制重登、人工兜底、
  人机验证前置、每日定时、导入导出、旧配置迁移。详见 [02-方案设计](dev/02-方案设计.md)。
