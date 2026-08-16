(function(root) {
  function getNewApiPostLoginUrl(domain, visitUrl) {
    return visitUrl || `https://${domain}/console/personal`;
  }

  function hasNewApiUserSession(session) {
    return Boolean(session?.userAuthenticated || session?.hasUser);
  }

  function buildNewApiLinuxDoOAuthUrl(clientId, state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      state
    });
    return `https://connect.linux.do/oauth2/authorize?${params.toString()}`;
  }

  function isNewApiOAuthCallbackUrl(url) {
    try {
      const parsed = new URL(url || '');
      return parsed.searchParams.has('code');
    } catch (e) {
      return false;
    }
  }

  function isNewApiTargetLoginPage(url, domain) {
    if (typeof root.isTargetSiteLoginPage === 'function') {
      return root.isTargetSiteLoginPage(url, domain) && !isNewApiOAuthCallbackUrl(url);
    }
    try {
      const parsed = new URL(url || '');
      return parsed.hostname === domain &&
        /^\/(?:login|sign-in|signin)(?:\/|$)/i.test(parsed.pathname) &&
        !isNewApiOAuthCallbackUrl(url);
    } catch (e) {
      return false;
    }
  }

  function parseNewApiUserId(user) {
    if (!user) return null;
    let parsed = user;
    if (typeof user === 'string') {
      try {
        parsed = JSON.parse(user);
      } catch (e) {
        return null;
      }
    }
    return parsed?.id || parsed?.user_id || parsed?.data?.id || parsed?.data?.user_id || null;
  }

  function buildNewApiExistingSessionHeaders({ cookies, user, token, tabId, baseHeaders } = {}) {
    const headers = { ...(baseHeaders || {}) };
    if (!headers.Cookie && !headers.cookie && Array.isArray(cookies) && cookies.length > 0) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }

    const userId = parseNewApiUserId(user);
    if (userId && !headers['New-API-User']) {
      headers['New-API-User'] = String(userId);
    }

    if (token && !Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) {
      headers.Authorization = /^bearer\s+/i.test(String(token)) ? String(token) : `Bearer ${token}`;
    }

    if (tabId) {
      headers._tabId = tabId;
    }
    return headers;
  }

  function shouldTryNewApiOAuth({ hasCachedHeaders, hasExistingSessionHeaders } = {}) {
    return !hasCachedHeaders && !hasExistingSessionHeaders;
  }

  root.buildNewApiExistingSessionHeaders = buildNewApiExistingSessionHeaders;
  root.buildNewApiLinuxDoOAuthUrl = buildNewApiLinuxDoOAuthUrl;
  root.getNewApiPostLoginUrl = getNewApiPostLoginUrl;
  root.hasNewApiUserSession = hasNewApiUserSession;
  root.isNewApiTargetLoginPage = isNewApiTargetLoginPage;
  root.parseNewApiUserId = parseNewApiUserId;
  root.shouldTryNewApiOAuth = shouldTryNewApiOAuth;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildNewApiExistingSessionHeaders,
      buildNewApiLinuxDoOAuthUrl,
      getNewApiPostLoginUrl,
      hasNewApiUserSession,
      isNewApiTargetLoginPage,
      parseNewApiUserId,
      shouldTryNewApiOAuth
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
