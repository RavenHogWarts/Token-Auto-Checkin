/**
 * 页面注入函数：元素点选器。用户在页面上点击目标元素，自动计算 CSS 选择器并回传。
 * 自包含（通过 chrome.scripting.executeScript 注入，不能引用外部变量）。
 * 支持连续点选多个；Esc 或右上角「完成」结束。
 */
export function startElementPicker(): { started: boolean } {
  const w = window as unknown as { __tacPickerActive?: boolean };
  if (w.__tacPickerActive) return { started: false };
  w.__tacPickerActive = true;

  const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: (m: unknown, cb?: () => void) => void } } })
    .chrome?.runtime;
  const send = (m: unknown): void => {
    try {
      runtime?.sendMessage?.(m, () => void 0);
    } catch {
      /* ignore */
    }
  };

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;z-index:2147483646;pointer-events:none;background:rgba(59,130,246,0.25);border:2px solid #3b82f6;border-radius:3px;transition:all .04s;display:none;';
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;background:#18181b;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:8px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;cursor:move;user-select:none;';
  const grip = document.createElement('span');
  grip.textContent = '⠿';
  grip.title = '按住拖动';
  grip.style.cssText = 'opacity:.6;cursor:move;';
  const tip = document.createElement('span');
  tip.textContent = '点选模式：点击目标元素（已选 0）· 可拖动';
  const done = document.createElement('button');
  done.textContent = '完成';
  done.style.cssText =
    'background:#22c55e;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;';
  bar.append(grip, tip, done);
  document.documentElement.append(overlay, bar);

  let count = 0;

  function cssSelector(el: Element): string {
    const esc = (s: string): string =>
      (window as unknown as { CSS?: { escape?: (v: string) => string } }).CSS?.escape?.(s) ?? s;
    if (el.id && document.querySelectorAll(`#${esc(el.id)}`).length === 1) return `#${esc(el.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      if (node.id && document.querySelectorAll(`#${esc(node.id)}`).length === 1) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      let sel = node.tagName.toLowerCase();
      const cls = Array.from(node.classList).filter(
        (c) => c && c.length < 40 && !/^(active|hover|focus|selected|open|show|is-|has-)/i.test(c),
      );
      if (cls[0]) sel += `.${esc(cls[0])}`;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      if (parts.length >= 5) break;
      node = parent;
    }
    return parts.join(' > ');
  }

  function moveOverlay(el: Element): void {
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${r.left}px`;
    overlay.style.top = `${r.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  }

  function onMove(e: MouseEvent): void {
    const el = e.target as Element | null;
    if (el && el !== overlay && el !== bar && !bar.contains(el)) moveOverlay(el);
  }

  function cleanup(): void {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointermove', onBarMove, true);
    document.removeEventListener('pointerup', onBarUp, true);
    overlay.remove();
    bar.remove();
    w.__tacPickerActive = false;
  }

  function finish(): void {
    cleanup();
    send({ type: 'event/element-pick-done' });
  }

  function onClick(e: MouseEvent): void {
    const el = e.target as Element | null;
    if (!el) return;
    if (el === done || bar.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const selector = cssSelector(el);
    if (selector) {
      count++;
      tip.textContent = `点选模式：点击目标元素（已选 ${count}）· 可拖动`;
      send({ type: 'event/element-picked', selector });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  }

  // 拖动工具条（按住任意处拖动，「完成」按钮除外；支持左/右键）
  let dragging = false;
  let offX = 0;
  let offY = 0;
  function onBarDown(e: PointerEvent): void {
    if (e.target === done) return;
    e.preventDefault();
    e.stopPropagation();
    const r = bar.getBoundingClientRect();
    bar.style.transform = 'none';
    bar.style.left = `${r.left}px`;
    bar.style.top = `${r.top}px`;
    bar.style.bottom = 'auto';
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    dragging = true;
    document.addEventListener('pointermove', onBarMove, true);
    document.addEventListener('pointerup', onBarUp, true);
  }
  function onBarMove(e: PointerEvent): void {
    if (!dragging) return;
    e.preventDefault();
    const x = Math.max(0, Math.min(window.innerWidth - bar.offsetWidth, e.clientX - offX));
    const y = Math.max(0, Math.min(window.innerHeight - bar.offsetHeight, e.clientY - offY));
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
  }
  function onBarUp(): void {
    dragging = false;
    document.removeEventListener('pointermove', onBarMove, true);
    document.removeEventListener('pointerup', onBarUp, true);
  }

  done.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish();
  });
  bar.addEventListener('pointerdown', onBarDown, true);
  bar.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  return { started: true };
}
