/** 时间与定时相关工具。移植自 reference/schedule.js 的行为。 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 校验 HH:mm 格式 */
export function isValidAutoSignTime(time: unknown): time is string {
  return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export const DEFAULT_AUTO_SIGN_TIME = '09:00';

/** 计算下一次某时刻（HH:mm）的运行时间戳（毫秒） */
export function getNextCheckInTimeFor(time: string, now: Date = new Date()): number {
  const [hoursStr, minutesStr] = time.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}
