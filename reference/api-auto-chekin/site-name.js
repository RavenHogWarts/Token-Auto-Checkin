(function(root) {
  function shouldAutoFetchSiteName(site) {
    const domain = String(site?.domain || '').trim();
    const name = String(site?.name || '').trim();
    return Boolean(domain) && (!name || name === domain);
  }

  function normalizeFetchedSiteName(name, domain) {
    const normalized = String(name || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^每日签到\s*-\s*/, '')
      .trim();
    if (!normalized) return null;
    if (normalized === String(domain || '').trim()) return null;
    return normalized;
  }

  function pickSiteDisplayName(metadata, domain) {
    const candidates = [
      metadata?.ogSiteName,
      metadata?.applicationName,
      metadata?.siteName,
      metadata?.title
    ];
    for (const candidate of candidates) {
      const normalized = normalizeFetchedSiteName(candidate, domain);
      if (normalized) return normalized;
    }
    return null;
  }

  root.shouldAutoFetchSiteName = shouldAutoFetchSiteName;
  root.normalizeFetchedSiteName = normalizeFetchedSiteName;
  root.pickSiteDisplayName = pickSiteDisplayName;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeFetchedSiteName,
      pickSiteDisplayName,
      shouldAutoFetchSiteName
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
