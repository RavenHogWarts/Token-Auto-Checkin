(function(root) {
  function formatReward(reward) {
    const value = Number(reward);
    if (!Number.isFinite(value)) return null;
    return value.toFixed(2);
  }

  function parseCheckInResponse(data, httpStatus, successOnHttpOk) {
    const zenApiAlreadyCheckedIn = data?.already_checked_in === true;
    const success =
      data?.success === true ||
      data?.status === 'success' ||
      data?.ret === 1 ||
      data?.code === 0 ||
      data?.ok === true ||
      (successOnHttpOk === true && httpStatus >= 200 && httpStatus < 300);

    const reward = formatReward(data?.reward);
    const rawMessage =
      data?.message ||
      data?.msg ||
      (zenApiAlreadyCheckedIn ? '今日已签到' : null) ||
      (reward ? `签到成功，获得 $${reward}` : null) ||
      data?.data ||
      '签到完成';
    const msgStr = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);

    const alreadyKeywords = ['已签到', '已经签到', '已签过', '今日已签', 'already', '重复签到'];
    const alreadyCheckedIn = zenApiAlreadyCheckedIn || alreadyKeywords.some(k => msgStr.includes(k));
    const pageExecutionKeywords = ['自动化脚本异常请求', '官方网页手动点击签到'];
    const requiresPageExecution = !success && pageExecutionKeywords.some(k => msgStr.includes(k));
    const securityCheckKeywords = ['Turnstile', '安全验证', '人机验证'];
    const requiresSecurityCheck = !success && securityCheckKeywords.some(k => msgStr.includes(k));

    const result = {
      success: success || alreadyCheckedIn,
      alreadyCheckedIn,
      message: msgStr,
      httpStatus,
      data
    };
    if (requiresPageExecution) {
      result.requiresPageExecution = true;
    }
    if (requiresSecurityCheck) {
      result.requiresSecurityCheck = true;
    }
    return result;
  }

  function shouldTryOfficialPageCheckIn(result) {
    return Boolean(result && !result.success && !result.alreadyCheckedIn && !result.invalidSite);
  }

  function markOfficialPageClickSuccess(result, clickedText) {
    if (!result || !clickedText) return result;
    return {
      ...result,
      success: true,
      alreadyCheckedIn: false,
      message: '签到成功',
      fallbackClicked: true
    };
  }

  root.parseCheckInResponse = parseCheckInResponse;
  root.shouldTryOfficialPageCheckIn = shouldTryOfficialPageCheckIn;
  root.markOfficialPageClickSuccess = markOfficialPageClickSuccess;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseCheckInResponse,
      shouldTryOfficialPageCheckIn,
      markOfficialPageClickSuccess
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
