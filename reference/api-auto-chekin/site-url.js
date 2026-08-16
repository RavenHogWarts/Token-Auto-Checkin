(function(root) {
  const DEFAULT_SITE_PAGE_PATH = '/console/personal';

  function normalizeUrlInput(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.includes('/')) return `https://${trimmed}`;
    return null;
  }

  function applySiteMode(site, mode) {
    if (mode === 'visit') {
      return { ...site, mode: 'visit' };
    }
    return site;
  }

  function normalizeSiteType(type) {
    return ['auto', 'newapi', 'sub2api', 'zenapi'].includes(type) ? type : 'auto';
  }

  function applySiteType(site, type) {
    if (site?.mode === 'visit') return site;
    const normalizedType = normalizeSiteType(type);
    if (normalizedType === 'auto' || normalizedType === 'sub2api' || normalizedType === 'zenapi') {
      return { ...site, type: normalizedType };
    }
    return site;
  }

  function parseSiteInput(input, mode = 'checkin', type = 'auto') {
    const rawInput = String(input || '').trim();
    const trimmed = rawInput.toLowerCase();
    if (!trimmed) return null;

    const normalizedUrl = normalizeUrlInput(rawInput);
    if (normalizedUrl) {
      try {
        const url = new URL(normalizedUrl);
        if (!url.hostname || !url.hostname.includes('.')) return null;
        const domain = url.hostname.toLowerCase();
        return applySiteType(applySiteMode({
          domain,
          name: domain,
          enabled: true,
          pageUrl: url.href
        }, mode), type);
      } catch (e) {
        return null;
      }
    }

    const domain = trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) return null;
    return applySiteType(applySiteMode({
      domain,
      name: domain,
      enabled: true
    }, mode), type);
  }

  function getSitePageUrl(site) {
    if (site?.pageUrl) return site.pageUrl;
    if (site?.type === 'zenapi') return `https://${site.domain}/user`;
    if (site?.type === 'sub2api') return `https://${site.domain}/check-in`;
    return `https://${site.domain}${DEFAULT_SITE_PAGE_PATH}`;
  }

  function getSiteTabCreateOptions(site) {
    return {
      url: getSitePageUrl(site),
      active: false
    };
  }

  root.parseSiteInput = parseSiteInput;
  root.getSitePageUrl = getSitePageUrl;
  root.getSiteTabCreateOptions = getSiteTabCreateOptions;
  root.normalizeSiteType = normalizeSiteType;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getSiteTabCreateOptions,
      normalizeSiteType,
      parseSiteInput,
      getSitePageUrl
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
