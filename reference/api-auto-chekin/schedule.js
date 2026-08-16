(function(root) {
  function isValidAutoSignTime(time) {
    if (typeof time !== 'string') return false;
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match) return false;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  function getNextCheckInTimeFor(time, now = new Date()) {
    if (!isValidAutoSignTime(time)) {
      throw new Error('Invalid auto sign time');
    }

    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  root.isValidAutoSignTime = isValidAutoSignTime;
  root.getNextCheckInTimeFor = getNextCheckInTimeFor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isValidAutoSignTime,
      getNextCheckInTimeFor
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
