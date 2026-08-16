(function(root) {
  function hasOwnStorageKey(storage, key) {
    return Object.prototype.hasOwnProperty.call(storage || {}, key);
  }

  function buildMissingInstallStorageDefaults(existingStorage = {}) {
    const defaults = {};
    if (!hasOwnStorageKey(existingStorage, 'lastCheckInTime')) {
      defaults.lastCheckInTime = null;
    }
    if (!hasOwnStorageKey(existingStorage, 'checkInResults')) {
      defaults.checkInResults = {};
    }
    return defaults;
  }

  root.buildMissingInstallStorageDefaults = buildMissingInstallStorageDefaults;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildMissingInstallStorageDefaults
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
