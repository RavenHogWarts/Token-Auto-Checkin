(function(root) {
  const INVALID_SITE_ERROR_CODE = 'INVALID_SITE';

  function isInvalidTabUrl(url) {
    return !url || String(url).startsWith('chrome-error://');
  }

  function isInvalidHttpStatus(status) {
    return status === 404 || status === 410;
  }

  function createInvalidSiteError(urlOrMessage) {
    const error = new Error('站点页面失效');
    error.code = INVALID_SITE_ERROR_CODE;
    if (urlOrMessage) {
      error.url = urlOrMessage;
    }
    return error;
  }

  function isInvalidSiteError(error) {
    return error?.code === INVALID_SITE_ERROR_CODE;
  }

  function createInvalidSiteResult(error) {
    return {
      status: 'invalid',
      message: error?.message || '站点页面失效'
    };
  }

  root.INVALID_SITE_ERROR_CODE = INVALID_SITE_ERROR_CODE;
  root.isInvalidTabUrl = isInvalidTabUrl;
  root.isInvalidHttpStatus = isInvalidHttpStatus;
  root.createInvalidSiteError = createInvalidSiteError;
  root.isInvalidSiteError = isInvalidSiteError;
  root.createInvalidSiteResult = createInvalidSiteResult;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      INVALID_SITE_ERROR_CODE,
      isInvalidTabUrl,
      isInvalidHttpStatus,
      createInvalidSiteError,
      isInvalidSiteError,
      createInvalidSiteResult
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
