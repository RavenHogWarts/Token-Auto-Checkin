(function(root) {
  function normalizeExportSites(sites, { orderedDomains = [], displayNamesByDomain = {} } = {}) {
    if (!Array.isArray(sites)) return [];

    const byDomain = new Map();
    const normalizedSites = [];
    for (const site of sites) {
      const domain = String(site?.domain || '').trim().toLowerCase();
      if (!domain || byDomain.has(domain)) continue;

      const displayName = String(displayNamesByDomain[domain] || '').trim();
      const name = displayName || String(site?.name || '').trim() || domain;
      const normalized = { ...site, domain, name };
      byDomain.set(domain, normalized);
      normalizedSites.push(normalized);
    }

    const ordered = [];
    const used = new Set();
    for (const domain of orderedDomains) {
      const normalizedDomain = String(domain || '').trim().toLowerCase();
      if (!normalizedDomain || used.has(normalizedDomain) || !byDomain.has(normalizedDomain)) continue;
      ordered.push(byDomain.get(normalizedDomain));
      used.add(normalizedDomain);
    }

    for (const site of normalizedSites) {
      if (used.has(site.domain)) continue;
      ordered.push(site);
    }

    return ordered;
  }

  function buildExportConfig(sites, autoSignTime, exportOptions = {}) {
    const config = { sites: normalizeExportSites(sites, exportOptions) };
    if (typeof root.isValidAutoSignTime === 'function' && root.isValidAutoSignTime(autoSignTime)) {
      config.autoSignTime = autoSignTime;
    }
    if (typeof exportOptions.focusHumanVerificationWindow === 'boolean') {
      config.focusHumanVerificationWindow = exportOptions.focusHumanVerificationWindow;
    }
    return config;
  }

  function getImportAutoSignTime(config) {
    const time = config?.autoSignTime;
    if (typeof root.isValidAutoSignTime === 'function' && root.isValidAutoSignTime(time)) {
      return time;
    }
    return null;
  }

  function getImportFocusHumanVerificationWindow(config) {
    return config?.focusHumanVerificationWindow === true;
  }

  function normalizeImportSites(sites) {
    if (!Array.isArray(sites)) return [];
    return sites
      .filter(site => site?.domain && typeof site.domain === 'string')
      .map(site => {
        if (site.mode === 'visit' || site.type) return site;
        return { ...site, type: 'auto' };
      });
  }

  function buildImportSites(currentSites, validSites, mode) {
    if (mode === 'cancel') return null;
    if (mode === 'replace' || !Array.isArray(currentSites) || currentSites.length === 0) {
      return validSites;
    }

    const existingDomains = new Set(currentSites.map(site => site.domain));
    const newSites = validSites.filter(site => !existingDomains.has(site.domain));
    return {
      sites: [...currentSites, ...newSites],
      newCount: newSites.length
    };
  }

  root.buildExportConfig = buildExportConfig;
  root.buildImportSites = buildImportSites;
  root.getImportFocusHumanVerificationWindow = getImportFocusHumanVerificationWindow;
  root.getImportAutoSignTime = getImportAutoSignTime;
  root.normalizeImportSites = normalizeImportSites;
  root.normalizeExportSites = normalizeExportSites;

  if (typeof module !== 'undefined' && module.exports) {
    const { isValidAutoSignTime } = require('./schedule.js');
    root.isValidAutoSignTime = isValidAutoSignTime;
    module.exports = {
      buildExportConfig,
      buildImportSites,
      getImportFocusHumanVerificationWindow,
      getImportAutoSignTime,
      normalizeExportSites,
      normalizeImportSites
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
