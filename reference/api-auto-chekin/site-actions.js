(function(root) {
  function getSiteActionDisplayName(site) {
    return site?.name || site?.domain || '该站点';
  }

  function getSiteModeView(site = {}) {
    const mode = site.mode === 'visit' ? 'visit' : 'checkin';
    if (mode === 'visit') {
      return {
        mode,
        nextMode: 'checkin',
        label: '访问',
        title: '点击切换为自动签到模式',
        className: 'visit'
      };
    }

    return {
      mode,
      nextMode: 'visit',
      label: '自动',
      title: '点击切换为访问模式',
      className: ''
    };
  }

  function getSwitchedSiteMode(site = {}) {
    const view = getSiteModeView(site);
    if (view.nextMode === 'visit') {
      return { ...site, mode: 'visit' };
    }

    const nextSite = { ...site };
    delete nextSite.mode;
    if (nextSite.type === 'visit' || !nextSite.type) {
      nextSite.type = 'auto';
    }
    return nextSite;
  }

  function buildModeSwitchConfirmationMessage(site = {}) {
    const view = getSiteModeView(site);
    const targetLabel = view.nextMode === 'visit' ? '访问模式' : '自动签到模式';
    return `确定将 ${getSiteActionDisplayName(site)} 切换为${targetLabel}？`;
  }

  function normalizeSiteRename(value) {
    const name = String(value || '').trim();
    return name || null;
  }

  function buildEditedSiteConfig(site = {}, values = {}, allSites = [], currentIndex = -1) {
    const name = normalizeSiteRename(values.name);
    if (!name) {
      return { site: null, error: '请输入站点名称' };
    }

    const mode = site.mode === 'visit' ? 'visit' : 'checkin';
    const type = site.type || 'auto';
    const parsedSite = typeof root.parseSiteInput === 'function'
      ? root.parseSiteInput(values.pageUrl, mode, type)
      : null;
    if (!parsedSite) {
      return { site: null, error: '请输入有效的签到页链接，如 c.com/console/personal' };
    }

    const nextDomain = String(parsedSite.domain || '').toLowerCase();
    const duplicate = Array.isArray(allSites) && allSites.some((candidate, index) => {
      if (index === currentIndex) return false;
      return String(candidate?.domain || '').toLowerCase() === nextDomain;
    });
    if (duplicate) {
      return { site: null, error: '该站点已存在' };
    }

    return {
      site: {
        ...site,
        ...parsedSite,
        name,
        enabled: site.enabled !== false
      },
      error: null
    };
  }

  root.getSiteActionDisplayName = getSiteActionDisplayName;
  root.getSiteModeView = getSiteModeView;
  root.getSwitchedSiteMode = getSwitchedSiteMode;
  root.buildModeSwitchConfirmationMessage = buildModeSwitchConfirmationMessage;
  root.normalizeSiteRename = normalizeSiteRename;
  root.buildEditedSiteConfig = buildEditedSiteConfig;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildEditedSiteConfig,
      buildModeSwitchConfirmationMessage,
      getSiteActionDisplayName,
      getSiteModeView,
      getSwitchedSiteMode,
      normalizeSiteRename
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
