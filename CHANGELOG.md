# 06 · 变更日志（Changelog）

约定：**每次功能更新递增一个 patch 版本**（`x.y.Z` 的 `Z`），并在此登记。版本号需同步三处：
[package.json](package.json) 的 `version`、[wxt.config.ts](wxt.config.ts) 的 `manifest.version`、
弹窗页脚 [index.html](src/entrypoints/popup/index.html) 的 `v…`。

遵循语义化版本：patch = 兼容的修复/小改；minor = 兼容的新功能（可按需升）；major = 破坏性变更。

---

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
