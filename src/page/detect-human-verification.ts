/**
 * 页面注入函数：探测当前页面是否存在人机验证。自包含。
 * config 通过 args 传入（不能引用外部作用域）。
 */
export interface HumanVerificationProbeResult {
  detected: boolean;
  url: string;
  title: string;
  selectorMatches: string[];
  textSample: string;
}

export function probeHumanVerification(config: {
  textPatternSource: string;
  selectors: string[];
}): HumanVerificationProbeResult {
  const text = document.body?.innerText || '';
  const selectorMatches: string[] = [];
  for (const selector of config.selectors || []) {
    try {
      if (document.querySelector(selector)) selectorMatches.push(selector);
    } catch {
      /* ignore invalid selector */
    }
  }
  const detected =
    new RegExp(config.textPatternSource, 'i').test(text) || selectorMatches.length > 0;

  // 通知 background（若在扩展上下文），便于「前置窗口交人工」。
  if (detected) {
    try {
      const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome
        ?.runtime;
      if (runtime && typeof (runtime as { sendMessage?: unknown }).sendMessage === 'function') {
        (runtime as { sendMessage: (m: unknown, cb?: () => void) => void }).sendMessage(
          { type: 'event/human-verification-detected' },
          () => void 0,
        );
      }
    } catch {
      /* ignore */
    }
  }

  return {
    detected,
    url: location.href,
    title: document.title,
    selectorMatches,
    textSample: text.replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}
