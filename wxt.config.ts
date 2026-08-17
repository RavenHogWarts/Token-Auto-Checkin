import { defineConfig } from 'wxt';

// WXT 配置：从 manifest 字段 + entrypoints 目录自动生成 MV3 manifest。
// 文档见 dev/03-技术栈选型.md、dev/04-架构设计.md
export default defineConfig({
  srcDir: 'src',
  // 关闭自动导入，统一走 `#imports` 显式导入，跨版本更稳定，便于类型检查。
  imports: false,
  manifest: {
    name: '公益站自动签到助手',
    description: '支持 NewAPI / Sub2API / ZenAPI 及自定义站点的公益站自动签到工具',
    version: '1.0.6',
    permissions: ['cookies', 'storage', 'alarms', 'scripting', 'tabs', 'windows', 'webRequest'],
    host_permissions: ['https://*/*'],
    action: {
      default_title: '公益站自动签到助手',
    },
  },
});
