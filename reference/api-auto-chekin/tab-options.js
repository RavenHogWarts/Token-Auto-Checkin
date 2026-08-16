(function(root) {
  function getTemporaryCheckInTabCreateOptions(url, options = {}) {
    return {
      url,
      active: options.active === true
    };
  }

  function isHumanVerificationResult(result = {}) {
    return result?.kind === 'security-check' || result?.requiresSecurityCheck === true;
  }

  function shouldKeepOfficialPageFallbackTabOpen(result = {}, options = {}) {
    return options.focusHumanVerificationWindow === true && isHumanVerificationResult(result);
  }

  function shouldOpenOfficialPageFallbackInForeground(result = {}, options = {}) {
    return shouldKeepOfficialPageFallbackTabOpen(result, options);
  }

  function getOfficialPageFallbackFailureMessage(pageResult = {}) {
    if (pageResult.kind === 'security-check') {
      return '站点要求完成 Turnstile 安全验证，自动签到已停止';
    }
    if (pageResult.kind === 'no-button') {
      return '未找到官方页面签到按钮，自动签到失败';
    }
    if (pageResult.kind === 'timeout') {
      return '官方页面签到请求超时，自动签到失败';
    }
    return '官方页面签到失败，自动签到已停止';
  }

  root.getTemporaryCheckInTabCreateOptions = getTemporaryCheckInTabCreateOptions;
  root.isHumanVerificationResult = isHumanVerificationResult;
  root.shouldOpenOfficialPageFallbackInForeground = shouldOpenOfficialPageFallbackInForeground;
  root.shouldKeepOfficialPageFallbackTabOpen = shouldKeepOfficialPageFallbackTabOpen;
  root.getOfficialPageFallbackFailureMessage = getOfficialPageFallbackFailureMessage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getTemporaryCheckInTabCreateOptions,
      getOfficialPageFallbackFailureMessage,
      isHumanVerificationResult,
      shouldOpenOfficialPageFallbackInForeground,
      shouldKeepOfficialPageFallbackTabOpen
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
