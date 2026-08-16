/**
 * 每日签到定时。移植自 reference/schedule.js + background.js scheduleDailyCheckIn。
 */
import { browser } from '#imports';
import { getAutoSignTime } from './storage';
import { getNextCheckInTimeFor, isValidAutoSignTime } from '../shared/time';

export const DAILY_CHECK_IN_ALARM = 'dailyCheckIn';

export async function scheduleDailyCheckIn(time?: string): Promise<string> {
  const autoSignTime = isValidAutoSignTime(time) ? time : await getAutoSignTime();
  const when = getNextCheckInTimeFor(autoSignTime);

  await browser.alarms.clear(DAILY_CHECK_IN_ALARM);
  await browser.alarms.create(DAILY_CHECK_IN_ALARM, {
    when,
    periodInMinutes: 24 * 60,
  });
  console.log(`[scheduler] 每日签到时间已设置为 ${autoSignTime}`);
  return autoSignTime;
}
