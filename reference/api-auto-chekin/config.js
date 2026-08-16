// 默认站点配置（首次安装时写入 storage）
const DEFAULT_SITES = [];

// 全局配置
const GLOBAL_CONFIG = {
  autoSignTime: '09:00',
  retryTimes: 2,
  requestTimeout: 10000
};

function normalizeSiteType(type) {
  return ['auto', 'newapi', 'sub2api', 'zenapi'].includes(type) ? type : 'newapi';
}

function dedupeSitesByDomain(sites) {
  if (!Array.isArray(sites)) return [];
  const seen = new Set();
  const deduped = [];
  for (const site of sites) {
    const domain = String(site?.domain || '').trim().toLowerCase();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    deduped.push({ ...site, domain });
  }
  return deduped;
}

// 从域名生成完整站点配置（多类型站点通用）
function buildSiteConfig(site) {
  const d = site.domain;
  const mode = site.mode === 'visit' ? 'visit' : 'checkin';
  const type = mode === 'visit' ? 'visit' : normalizeSiteType(site.type);
  const apiBasePathByType = {
    sub2api: '/api/v1/user/check-in',
    zenapi: '/api/u/checkin'
  };
  const defaultPagePathByType = {
    sub2api: '/check-in',
    zenapi: '/user'
  };
  const queryPathByType = {
    zenapi: '/api/u/dashboard'
  };
  const apiBasePath = apiBasePathByType[type] || '/api/user/checkin';
  const defaultPagePath = defaultPagePathByType[type] || '/console/personal';
  const queryPath = queryPathByType[type] || apiBasePath;
  return {
    siteId: d.replace(/\./g, '_'),
    siteName: site.name || d,
    enabled: site.enabled !== false,
    mode,
    type,
    visitUrl: site.pageUrl || `https://${d}${defaultPagePath}`,
    cookieDomain: d,
    signExecUrl: `https://${d}${apiBasePath}`,
    signExecMethod: 'POST',
    signExecParams: {},
    signQueryUrl: `https://${d}${queryPath}`,
    signQueryMethod: 'GET',
    cookieTestUrl: `https://${d}/`,
    unauthKeywords: ['未登录', '请登录']
  };
}

// 从 storage 加载站点列表
async function loadSitesConfig() {
  const data = await chrome.storage.local.get('userSites');
  const sites = Array.isArray(data.userSites) ? data.userSites : [...DEFAULT_SITES];
  return dedupeSitesByDomain(sites).map(buildSiteConfig);
}

// 保存站点列表到 storage
async function saveSitesConfig(sites) {
  await chrome.storage.local.set({ userSites: dedupeSitesByDomain(sites) });
}

// 读取原始站点列表（简化格式）
async function loadRawSites() {
  const data = await chrome.storage.local.get('userSites');
  const sites = Array.isArray(data.userSites) ? data.userSites : [...DEFAULT_SITES];
  return dedupeSitesByDomain(sites);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SITES,
    buildSiteConfig,
    dedupeSitesByDomain,
    normalizeSiteType
  };
}
