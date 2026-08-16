/**
 * manual-assist 签到策略（场景 C 人工兜底）：前台打开页面，交用户手动完成。
 * 复用 page-click 逻辑，强制 keepTabForManual = true。
 */
import type { AuthContext, CheckinStrategyImpl, RunContext } from '../../core/context';
import type { CheckinResult } from '../../domain/checkin-result';
import type { SiteProfile } from '../../domain/site-profile';
import { pageClickCheckin } from './page-click';

export const manualAssistCheckin: CheckinStrategyImpl = {
  name: 'manual-assist',
  run(profile: SiteProfile, auth: AuthContext, ctx: RunContext): Promise<CheckinResult> {
    const merged: SiteProfile = {
      ...profile,
      checkin: {
        ...profile.checkin,
        click: { ...profile.checkin.click, keepTabForManual: true },
      },
    };
    return pageClickCheckin.run(merged, auth, ctx);
  },
};
