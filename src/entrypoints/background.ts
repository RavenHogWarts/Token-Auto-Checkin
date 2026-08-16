import { browser, defineBackground } from '#imports';
import { handleMessage } from '../core/messaging';
import { startBatchRun } from '../core/orchestrator';
import { DAILY_CHECK_IN_ALARM, scheduleDailyCheckIn } from '../services/scheduler';
import { migrateLegacyIfNeeded } from '../services/storage';
import type { Message } from '../domain/messages';
// 注册人机验证监控相关的 tabs.onRemoved 监听（模块副作用）
import '../services/human-verification';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('公益站自动签到助手已安装');
    void migrateLegacyIfNeeded().catch((e) => console.error('迁移旧配置失败:', e));
    void scheduleDailyCheckIn();
  });

  browser.runtime.onStartup.addListener(() => {
    void scheduleDailyCheckIn();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_CHECK_IN_ALARM) {
      console.log('开始执行定时签到');
      void startBatchRun('schedule');
    }
  });

  // 经典异步响应模式：返回 true 保持消息通道，Promise 完成后 sendResponse。
  // 兼容原生 chrome 与 webextension-polyfill 两种 browser 实现。
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message as Message, sender)
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ success: false, error: e.message }));
    return true;
  });
});
