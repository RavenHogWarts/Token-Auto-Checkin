/**
 * 余额解析（纯函数，在 background 中对页面/接口返回的数据运行）。
 * 移植自 reference/balance.js。
 */

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
  'quota',
];

function formatNumber(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return value.toFixed(2);
}

export function formatBalanceValue(value: unknown, key = ''): string | null {
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

export function extractBalanceFromData(data: unknown): string | null {
  const seen = new Set<object>();

  function walk(value: unknown): string | null {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return null;
    seen.add(value as object);

    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (BALANCE_KEYS.includes(key.toLowerCase())) {
        const formatted = formatBalanceValue(child, key);
        if (formatted) return formatted;
      }
    }
    for (const [, child] of entries) {
      if (!child || typeof child !== 'object') continue;
      const formatted = walk(child);
      if (formatted) return formatted;
    }
    return null;
  }

  return walk(data);
}

export function extractBalanceFromText(text: string): string | null {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const patterns = [
    /(?:账户余额|账号余额|当前余额|剩余余额|余额|Balance|Credit|Credits)\s*[:：]?\s*([$¥￥]?\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?)/i,
    /([$¥￥]\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:账户余额|账号余额|当前余额|剩余余额|余额|Balance|Credit|Credits)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return formatBalanceValue(match[1]);
  }
  return null;
}

export function extractSub2ApiBalanceFromTexts(texts: string[] = []): string | null {
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
