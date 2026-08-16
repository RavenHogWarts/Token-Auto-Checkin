(function(root) {
  function hasAuthorizationHeader(headers) {
    return Object.entries(headers || {}).some(([name, value]) => {
      return name.toLowerCase() === 'authorization' && String(value || '').trim() !== '';
    });
  }

  function buildAuthorizationValue(token) {
    const trimmed = String(token || '').trim();
    if (!trimmed) return null;
    return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
  }

  function mergeAuthorizationHeader(headers, token) {
    const nextHeaders = { ...(headers || {}) };
    if (hasAuthorizationHeader(nextHeaders)) return nextHeaders;

    const authorization = buildAuthorizationValue(token);
    if (authorization) {
      nextHeaders.Authorization = authorization;
    }
    return nextHeaders;
  }

  root.hasAuthorizationHeader = hasAuthorizationHeader;
  root.mergeAuthorizationHeader = mergeAuthorizationHeader;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      hasAuthorizationHeader,
      mergeAuthorizationHeader
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
