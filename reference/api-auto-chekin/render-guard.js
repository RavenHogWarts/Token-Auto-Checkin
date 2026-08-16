(function(root) {
  function createLatestRenderGuard() {
    let currentToken = 0;
    return {
      begin() {
        currentToken += 1;
        return currentToken;
      },
      isCurrent(token) {
        return token === currentToken;
      }
    };
  }

  root.createLatestRenderGuard = createLatestRenderGuard;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createLatestRenderGuard
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
