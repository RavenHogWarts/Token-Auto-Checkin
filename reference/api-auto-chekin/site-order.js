(function(root) {
  function normalizeOrderDomain(domain) {
    return String(domain || '').trim().toLowerCase();
  }

  function reorderSitesByDomains(sites, orderedDomains = []) {
    if (!Array.isArray(sites)) return [];

    const byDomain = new Map();
    for (const site of sites) {
      const domain = normalizeOrderDomain(site?.domain);
      if (domain && !byDomain.has(domain)) {
        byDomain.set(domain, site);
      }
    }

    const ordered = [];
    const used = new Set();
    for (const domain of orderedDomains) {
      const normalizedDomain = normalizeOrderDomain(domain);
      if (!normalizedDomain || used.has(normalizedDomain) || !byDomain.has(normalizedDomain)) continue;
      ordered.push(byDomain.get(normalizedDomain));
      used.add(normalizedDomain);
    }

    for (const site of sites) {
      const domain = normalizeOrderDomain(site?.domain);
      if (domain && used.has(domain)) continue;
      ordered.push(site);
      if (domain) used.add(domain);
    }

    return ordered;
  }

  root.reorderSitesByDomains = reorderSitesByDomains;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      reorderSitesByDomains
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
