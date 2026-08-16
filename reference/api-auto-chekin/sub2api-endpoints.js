(function(root) {
  const SUB2API_LEGACY_CHECK_IN_PATH = '/api/v1/user/check-in';
  const SUB2API_CHECK_IN_PATH = '/api/v1/check-in';
  const MISSING_ENDPOINT_STATUSES = new Set([404, 405, 410]);

  function normalizeUrl(url) {
    if (!url) return null;
    const text = String(url).trim();
    return text || null;
  }

  function addUniqueUrl(urls, url) {
    const normalized = normalizeUrl(url);
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  }

  function getSub2ApiCheckInUrls(site = {}) {
    const urls = [];
    addUniqueUrl(urls, site.signExecUrl);

    const domain = String(site.cookieDomain || '').trim();
    if (domain) {
      addUniqueUrl(urls, `https://${domain}${SUB2API_LEGACY_CHECK_IN_PATH}`);
      addUniqueUrl(urls, `https://${domain}${SUB2API_CHECK_IN_PATH}`);
    }

    return urls;
  }

  function shouldTryNextSub2ApiCheckInEndpoint(result = {}) {
    return MISSING_ENDPOINT_STATUSES.has(result?.httpStatus);
  }

  async function requestSub2ApiCheckIn(site = {}, headers = {}, requestCheckIn) {
    if (typeof requestCheckIn !== 'function') {
      return { success: false, error: 'Sub2API 签到请求器未配置', httpStatus: 0 };
    }

    const checkInUrls = getSub2ApiCheckInUrls(site);
    let lastResult = null;

    for (const url of checkInUrls) {
      const result = await requestCheckIn(url, site.signExecMethod, site.signExecParams, headers);
      lastResult = {
        ...(result || { success: false, error: 'Sub2API 签到响应为空', httpStatus: 0 }),
        usedCheckInUrl: url
      };

      if (!shouldTryNextSub2ApiCheckInEndpoint(lastResult)) {
        return lastResult;
      }
    }

    return lastResult || { success: false, error: 'Sub2API 签到接口未配置', httpStatus: 0 };
  }

  root.getSub2ApiCheckInUrls = getSub2ApiCheckInUrls;
  root.requestSub2ApiCheckIn = requestSub2ApiCheckIn;
  root.shouldTryNextSub2ApiCheckInEndpoint = shouldTryNextSub2ApiCheckInEndpoint;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getSub2ApiCheckInUrls,
      requestSub2ApiCheckIn,
      shouldTryNextSub2ApiCheckInEndpoint
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
