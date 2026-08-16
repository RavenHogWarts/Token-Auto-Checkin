/**
 * 轻量日志封装：统一前缀便于在 service worker 控制台过滤，
 * 同时把每条日志同步写入运行日志（storage），供弹窗「运行日志」标签实时展示。
 */
import { appendLog } from '../services/run-log';

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 500);
}

export function createLogger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    log: (...args: unknown[]) => {
      console.log(prefix, ...args);
      void appendLog('info', stringify(args), { scope });
    },
    warn: (...args: unknown[]) => {
      console.warn(prefix, ...args);
      void appendLog('warn', stringify(args), { scope });
    },
    error: (...args: unknown[]) => {
      console.error(prefix, ...args);
      void appendLog('error', stringify(args), { scope });
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
