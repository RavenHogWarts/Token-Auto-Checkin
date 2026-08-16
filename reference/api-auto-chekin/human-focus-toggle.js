(function(root) {
  const HUMAN_FOCUS_TOGGLE_KEY = 'focusHumanVerificationWindow';
  const HUMAN_VERIFICATION_DETECTED_MESSAGE = 'humanVerificationDetected';

  function hasHumanFocusToggleState(record = {}) {
    return typeof record?.[HUMAN_FOCUS_TOGGLE_KEY] === 'boolean';
  }

  function getHumanFocusToggleState(record = {}) {
    return record?.[HUMAN_FOCUS_TOGGLE_KEY] === true;
  }

  function resolveHumanFocusToggleState(currentChecked, record = {}) {
    if (!hasHumanFocusToggleState(record)) {
      return currentChecked === true;
    }
    return getHumanFocusToggleState(record);
  }

  function buildHumanVerificationDetectedMessage() {
    return { action: HUMAN_VERIFICATION_DETECTED_MESSAGE };
  }

  function isHumanVerificationDetectedMessage(message = {}) {
    return message?.action === HUMAN_VERIFICATION_DETECTED_MESSAGE;
  }

  root.HUMAN_VERIFICATION_DETECTED_MESSAGE = HUMAN_VERIFICATION_DETECTED_MESSAGE;
  root.buildHumanVerificationDetectedMessage = buildHumanVerificationDetectedMessage;
  root.getHumanFocusToggleState = getHumanFocusToggleState;
  root.hasHumanFocusToggleState = hasHumanFocusToggleState;
  root.isHumanVerificationDetectedMessage = isHumanVerificationDetectedMessage;
  root.resolveHumanFocusToggleState = resolveHumanFocusToggleState;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      HUMAN_VERIFICATION_DETECTED_MESSAGE,
      buildHumanVerificationDetectedMessage,
      getHumanFocusToggleState,
      hasHumanFocusToggleState,
      isHumanVerificationDetectedMessage,
      resolveHumanFocusToggleState
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
