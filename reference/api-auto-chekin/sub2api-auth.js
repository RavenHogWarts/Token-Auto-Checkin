(function(root) {
  function getSub2ApiOAuthRedirect(currentUrl = '') {
    try {
      const parsed = new URL(currentUrl || '');
      const redirect = parsed.searchParams.get('redirect');
      if (redirect && redirect.startsWith('/')) return redirect;

      if (parsed.pathname && !/^\/login(?:\/|$)/i.test(parsed.pathname)) {
        return `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}` || '/check-in';
      }

      return '/check-in';
    } catch (e) {
      return '/check-in';
    }
  }

  function buildSub2ApiLinuxDoOAuthStartUrl(domain, visitUrl = null) {
    const redirect = getSub2ApiOAuthRedirect(visitUrl);
    const params = new URLSearchParams({ redirect });
    return `https://${domain}/api/v1/auth/oauth/linuxdo/start?${params.toString()}`;
  }

  function getSub2ApiPostLoginUrl(domain, visitUrl = null) {
    return `https://${domain}${getSub2ApiOAuthRedirect(visitUrl)}`;
  }

  function isSub2ApiTargetLoginPage(url, domain) {
    if (typeof root.isTargetSiteLoginPage === 'function') {
      return root.isTargetSiteLoginPage(url, domain);
    }
    try {
      const parsed = new URL(url || '');
      const hasCallbackToken = ['code', 'token', 'access_token', 'auth_token', 'id_token', 'linuxdo_token', 'user_token']
        .some(name => parsed.searchParams.get(name));
      return parsed.hostname === domain &&
        /^\/(?:login|sign-in|signin)(?:\/|$)/i.test(parsed.pathname) &&
        !hasCallbackToken;
    } catch (e) {
      return false;
    }
  }

  root.buildSub2ApiLinuxDoOAuthStartUrl = buildSub2ApiLinuxDoOAuthStartUrl;
  root.getSub2ApiOAuthRedirect = getSub2ApiOAuthRedirect;
  root.getSub2ApiPostLoginUrl = getSub2ApiPostLoginUrl;
  root.isSub2ApiTargetLoginPage = isSub2ApiTargetLoginPage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildSub2ApiLinuxDoOAuthStartUrl,
      getSub2ApiOAuthRedirect,
      getSub2ApiPostLoginUrl,
      isSub2ApiTargetLoginPage
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
