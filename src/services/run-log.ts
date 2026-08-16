/**
 * 运行日志：把签到过程中的高层事件写入 storage，供弹窗「运行日志」标签展示。
 * 采用串行队列避免 read-modify-write 竞争；环形缓冲，最多保留 CAP 条。
 */
import { browser } from '#imports';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  t: number;
  level: LogLevel;
  scope?: string;
  site?: string;
  msg: string;
}

export const RUN_LOG_KEY = 'runLog';
const CAP = 500;

let queue: Promise<void> = Promise.resolve();

async function readLogs(): Promise<LogEntry[]> {
  const data = await browser.storage.local.get(RUN_LOG_KEY);
  const value = (data as Record<string, unknown>)[RUN_LOG_KEY];
  return Array.isArray(value) ? (value as LogEntry[]) : [];
}

export interface LogMeta {
  site?: string;
  scope?: string;
}

export function appendLog(level: LogLevel, msg: string, meta: LogMeta = {}): Promise<void> {
  queue = queue
    .then(async () => {
      const logs = await readLogs();
      logs.push({
        t: Date.now(),
        level,
        msg,
        ...(meta.site ? { site: meta.site } : {}),
        ...(meta.scope ? { scope: meta.scope } : {}),
      });
      if (logs.length > CAP) logs.splice(0, logs.length - CAP);
      await browser.storage.local.set({ [RUN_LOG_KEY]: logs });
    })
    .catch(() => undefined);
  return queue;
}

export function getLogs(): Promise<LogEntry[]> {
  return readLogs();
}

export async function clearLogs(): Promise<void> {
  await browser.storage.local.set({ [RUN_LOG_KEY]: [] });
}
