const test = require('node:test');
const assert = require('node:assert/strict');

require('./site-url.js');
const { buildEditedSiteConfig } = require('./site-actions.js');

test('buildEditedSiteConfig updates name and page URL while preserving site properties', () => {
  assert.equal(typeof buildEditedSiteConfig, 'function');

  const currentSite = {
    domain: 'old.example.com',
    name: '旧站点',
    enabled: false,
    type: 'sub2api',
    pageUrl: 'https://old.example.com/check-in'
  };

  const result = buildEditedSiteConfig(
    currentSite,
    { name: '新站点', pageUrl: 'https://new.example.com/check-in' },
    [currentSite],
    0
  );

  assert.equal(result.error, null);
  assert.equal(result.site.name, '新站点');
  assert.equal(result.site.domain, 'new.example.com');
  assert.equal(result.site.pageUrl, 'https://new.example.com/check-in');
  assert.equal(result.site.enabled, false);
  assert.equal(result.site.type, 'sub2api');
});

test('buildEditedSiteConfig rejects duplicate edited domains', () => {
  const currentSite = { domain: 'old.example.com', name: '旧站点', enabled: true };
  const otherSite = { domain: 'other.example.com', name: '其他站点', enabled: true };

  const result = buildEditedSiteConfig(
    currentSite,
    { name: '新站点', pageUrl: 'https://other.example.com/console/personal' },
    [currentSite, otherSite],
    0
  );

  assert.equal(result.site, null);
  assert.equal(result.error, '该站点已存在');
});

test('buildEditedSiteConfig rejects empty names and invalid addresses', () => {
  const currentSite = { domain: 'old.example.com', name: '旧站点', enabled: true };

  assert.equal(
    buildEditedSiteConfig(currentSite, { name: ' ', pageUrl: 'https://new.example.com/console/personal' }, [currentSite], 0).error,
    '请输入站点名称'
  );
  assert.equal(
    buildEditedSiteConfig(currentSite, { name: '新站点', pageUrl: 'not-a-url' }, [currentSite], 0).error,
    '请输入有效的签到页链接，如 c.com/console/personal'
  );
});
