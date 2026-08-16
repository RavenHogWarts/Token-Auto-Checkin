(function(root) {
  const QUOTA_UNIT = 500000;
  const BALANCE_KEYS = [
    'balance',
    'amount',
    'credit',
    'credits',
    'money',
    'wallet',
    'remaining_balance',
    'remain_balance',
    'available_balance',
    'quota'
  ];

  function formatNumber(value) {
    if (Math.abs(value - Math.round(value)) < 0.000001) {
      return String(Math.round(value));
    }
    return value.toFixed(2);
  }

  function formatBalanceValue(value, key = '') {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return null;
      const numeric = Number(normalized.replace(/[$¥￥,]/g, ''));
      if (!Number.isFinite(numeric)) return normalized;
      if (/quota/i.test(key)) return `$${(numeric / QUOTA_UNIT).toFixed(2)}`;
      return normalized;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (/quota/i.test(key)) return `$${(numeric / QUOTA_UNIT).toFixed(2)}`;
    return formatNumber(numeric);
  }

  function extractBalanceFromData(data) {
    const seen = new Set();

    function walk(value, path = '') {
      if (!value || typeof value !== 'object' || seen.has(value)) return null;
      seen.add(value);

      for (const [key, child] of Object.entries(value)) {
        const lowerKey = key.toLowerCase();
        if (BALANCE_KEYS.includes(lowerKey)) {
          const formatted = formatBalanceValue(child, key);
          if (formatted) return formatted;
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if (!child || typeof child !== 'object') continue;
        const formatted = walk(child, path ? `${path}.${key}` : key);
        if (formatted) return formatted;
      }
      return null;
    }

    return walk(data);
  }

  function extractBalanceFromCheckInResult(result) {
    return extractBalanceFromData(result?.data) || formatBalanceValue(result?.balance);
  }

  function extractSub2ApiBalanceFromTexts(texts = []) {
    if (!Array.isArray(texts)) return null;

    for (const text of texts) {
      const fromLabel = extractBalanceFromText(text);
      if (fromLabel) return fromLabel;

      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      if (/^[$¥￥]?\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?$/.test(normalized)) {
        const formatted = formatBalanceValue(normalized);
        if (formatted) return formatted;
      }
    }

    return null;
  }

  function extractBalanceFromText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    const patterns = [
      /(?:账户余额|账号余额|当前余额|剩余余额|余额|Balance|Credit|Credits)\s*[:：]?\s*([$¥￥]?\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?)/i,
      /([$¥￥]\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:账户余额|账号余额|当前余额|剩余余额|余额|Balance|Credit|Credits)/i
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return formatBalanceValue(match[1]);
    }
    return null;
  }

  root.formatBalanceValue = formatBalanceValue;
  root.extractBalanceFromCheckInResult = extractBalanceFromCheckInResult;
  root.extractBalanceFromData = extractBalanceFromData;
  root.extractSub2ApiBalanceFromTexts = extractSub2ApiBalanceFromTexts;
  root.extractBalanceFromText = extractBalanceFromText;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      extractBalanceFromCheckInResult,
      extractBalanceFromData,
      extractSub2ApiBalanceFromTexts,
      extractBalanceFromText,
      formatBalanceValue
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
