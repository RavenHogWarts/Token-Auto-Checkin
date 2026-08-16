/**
 * 页面注入函数：从 localStorage / sessionStorage 读取 token。
 * 通过 chrome.scripting.executeScript 在页面上下文执行，必须自包含（不引用外部作用域）。
 */
export function readTokenFromStorage(keys: string[]): string | null {
  const tokenKeys = Array.isArray(keys) ? keys : [];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (token) return token;
  }
  return null;
}
