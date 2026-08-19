# 公益站自动签到助手（v2 · TypeScript + WXT）

基于**声明式站点策略**重写的 Chrome MV3 扩展。设计文档见 [`dev/`](./dev/)，旧版参考实现见 [`reference/`](./reference/)。

## 致谢与来源声明

本项目并非从零原创。其最初的思路与实现源自开源项目
**[Ginkgoooo/newapi-auto-checkin](https://github.com/Ginkgoooo/newapi-auto-checkin)**。

在到达本仓库之前，代码已经过若干位作者辗转修改、传递了不知多少个版本；本仓库 [`reference/`](./reference/)
下保存的即是我拿到的那份「原生 JS 版」，本项目（v2）是在其基础上用 TypeScript + WXT 重写、
并扩展了声明式站点策略、多 OAuth 提供方、元素点选、运行日志等能力。

在此向上游原作者 [@Ginkgoooo](https://github.com/Ginkgoooo) 以及沿途所有贡献者致谢。
如原始项目采用特定开源许可（如 MIT），本项目在其基础上的修改沿用相同条款。

## 技术栈

- **TypeScript**（strict）+ **WXT**（基于 Vite 的浏览器扩展框架）
- 原生 TS 弹窗 UI（无前端框架）
- **Vitest** 单测、ESLint、Prettier
- 包管理：**pnpm**

## 快速开始

```bash
pnpm install        # 安装依赖（postinstall 会执行 wxt prepare 生成 .wxt 类型）
pnpm dev            # 开发模式（HMR，自动加载扩展）
pnpm build          # 构建生产版本到 .output/chrome-mv3
pnpm compile        # tsc --noEmit 类型检查
pnpm test           # 运行单元测试
pnpm lint           # ESLint
```

加载扩展：`chrome://extensions` → 开启开发者模式 → 加载已解压的扩展 → 选择 `.output/chrome-mv3`。

## 核心概念：两个正交维度

每个站点是一份 `SiteProfile`，签到方式由两个维度组合而成（见 [dev/02-方案设计.md](./dev/02-方案设计.md)）：

- **认证策略** `auth.strategy`：`cookie` / `session-reuse` / `oauth-linuxdo` / `token-storage` / `bearer-sniff` / `force-relogin`
- **签到策略** `checkin.strategy`：`api` / `visit` / `page-click` / `manual-assist` / `record-only`

三类典型场景的落点：

| 场景 | 配置 |
| --- | --- |
| 打开网站（cookie）即签 | `auth: cookie` + `checkin: visit` |
| 需退出重新登录 | `auth: force-relogin` + `checkin: api \| page-click` |
| 个人资料页签到（新版 NewAPI，token 只在内存） | 预设 `newapi-profile`（`auth: bearer-sniff` + `checkin: api`） |
| 需手动点击签到位置 | `checkin: page-click`（`click.selectors` 自定义选择器）或 `manual-assist`（前台交人工） |
| 仅记录站点，不参与自动签到 | 预设 `record-only`（`checkin: record-only`，无 tab / 无认证 / 无请求） |

## 目录结构

```
src/
  entrypoints/   background.ts、popup/         入口
  core/          orchestrator/pipeline/tab-session/messaging/balance/context
  strategies/    auth/*（认证策略）、checkin/*（签到策略）
  page/          注入页面上下文执行的自包含函数
  domain/        纯类型与纯函数（Profile/结果/预设/迁移/余额/OAuth URL）
  services/      storage/tabs/scheduler/human-verification/checkin-request
  shared/        url/time/logger/auth-headers
  test/          Vitest 用例
```

## 数据与迁移

数据仅存本地 `chrome.storage.local`。首次启动会把旧版 `userSites` 自动迁移为 `siteProfiles`（保留 `legacyBackup` 备份）。
