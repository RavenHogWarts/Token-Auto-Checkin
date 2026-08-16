import { describe, expect, it } from 'vitest';
import { buildSiteProfile, siteIdFromDomain } from '../domain/presets';
import { migrateLegacySites } from '../domain/migration';
import { parseCheckInResponse, toCheckinResult } from '../domain/checkin-result';
import { extractBalanceFromText, extractBalanceFromData } from '../domain/balance';
import { parseSiteInput, isTargetSiteLoginPage, hasOAuthCallbackCredential } from '../shared/url';

describe('presets / buildSiteProfile', () => {
  it('newapi 预设填充接口默认值', () => {
    const p = buildSiteProfile({ domain: 'a.com', preset: 'newapi' });
    expect(p.id).toBe(siteIdFromDomain('a.com'));
    expect(p.auth.strategy).toBe('session-reuse');
    expect(p.checkin.strategy).toBe('api');
    expect(p.checkin.api?.execUrl).toBe('https://a.com/api/user/checkin');
  });

  it('custom 预设默认 cookie + visit', () => {
    const p = buildSiteProfile({ domain: 'b.com', preset: 'custom' });
    expect(p.auth.strategy).toBe('cookie');
    expect(p.checkin.strategy).toBe('visit');
  });

  it('forceReloginEveryRun 语义糖切换策略', () => {
    const p = buildSiteProfile({ domain: 'c.com', preset: 'newapi', auth: { forceReloginEveryRun: true } });
    expect(p.auth.strategy).toBe('force-relogin');
  });
});

describe('legacy migration', () => {
  it('visit 模式迁移为 custom + visit', () => {
    const [p] = migrateLegacySites([{ domain: 'x.com', mode: 'visit', type: 'newapi' }]);
    expect(p?.preset).toBe('custom');
    expect(p?.checkin.strategy).toBe('visit');
  });

  it('sub2api 类型迁移保留预设并去重', () => {
    const list = migrateLegacySites([
      { domain: 'y.com', type: 'sub2api' },
      { domain: 'y.com', type: 'sub2api' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.preset).toBe('sub2api');
  });
});

describe('checkin response parsing', () => {
  it('already checked in', () => {
    const r = parseCheckInResponse({ message: '今日已签到' }, 200);
    expect(r.alreadyCheckedIn).toBe(true);
    expect(toCheckinResult(r).status).toBe('already');
  });

  it('security check maps to needs-human', () => {
    const r = parseCheckInResponse({ message: '请完成人机验证' }, 200);
    expect(toCheckinResult(r).status).toBe('needs-human');
  });

  it('success flag', () => {
    const r = parseCheckInResponse({ success: true, reward: 1 }, 200);
    expect(toCheckinResult(r).status).toBe('success');
  });
});

describe('balance', () => {
  it('from text', () => {
    expect(extractBalanceFromText('当前余额: $12.50')).toBe('$12.50');
  });
  it('from data quota', () => {
    expect(extractBalanceFromData({ quota: 500000 })).toBe('$1.00');
  });
});

describe('url helpers', () => {
  it('parseSiteInput domain only', () => {
    expect(parseSiteInput('example.com')?.domain).toBe('example.com');
  });
  it('login page detection excludes callback', () => {
    expect(isTargetSiteLoginPage('https://a.com/login', 'a.com')).toBe(true);
    expect(isTargetSiteLoginPage('https://a.com/login?code=x', 'a.com')).toBe(false);
    expect(hasOAuthCallbackCredential('https://a.com/cb?code=x')).toBe(true);
  });
});
