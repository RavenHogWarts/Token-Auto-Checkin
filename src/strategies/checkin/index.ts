/** 签到策略注册表 + 统一入口。 */
import type { CheckinStrategyImpl } from '../../core/context';
import type { CheckinStrategy } from '../../domain/site-profile';
import { apiCheckin } from './api';
import { manualAssistCheckin } from './manual-assist';
import { pageClickCheckin } from './page-click';
import { visitCheckin } from './page-visit';

const registry = new Map<CheckinStrategy, CheckinStrategyImpl>();

export function registerCheckinStrategy(impl: CheckinStrategyImpl): void {
  registry.set(impl.name, impl);
}

[apiCheckin, visitCheckin, pageClickCheckin, manualAssistCheckin].forEach(registerCheckinStrategy);

export function getCheckinStrategy(name: CheckinStrategy): CheckinStrategyImpl {
  return registry.get(name) ?? visitCheckin;
}
