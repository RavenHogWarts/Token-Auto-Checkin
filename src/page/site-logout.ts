/**
 * 页面注入函数：在站点内执行「彻底登出」。自包含，运行在页面上下文（chrome.scripting）。
 *
 * agentrouter 等 New API / One API 站点为 cookie-store 无状态 session：
 * 登录态直接编码在 session cookie 里，服务端无 session 存储可撤销；前端则用 localStorage.user
 * 判断是否已登录。因此「彻底登出」= 调官方登出接口让服务端下发空 session
 * + 清掉 localStorage/sessionStorage 里的登录态键。站点 cookie 由后台 removeDomainCookies 兜底删除。
 */
export interface SiteLogoutInput {
  /** 官方登出接口路径（尽力而为，GET）。如 '/api/user/logout' */
  logoutPaths: string[];
  /** 存放用户信息的 localStorage 键（用于解析 New-Api-User 头 + 清理）。如 ['user'] */
  userKeys: string[];
  /** token 键（localStorage / sessionStorage 一并清理）。如 ['token','access_token'] */
  tokenKeys: string[];
}

export interface SiteLogoutResult {
  /** 官方登出接口返回的 HTTP 状态；未命中或全部失败为 null */
  logoutStatus: number | null;
  /** 实际从 localStorage 清除的键 */
  clearedKeys: string[];
  /** 解析到的用户 id（用于日志与请求头） */
  userId: string | null;
}

export async function performSiteLogout(input: SiteLogoutInput): Promise<SiteLogoutResult> {
  const userKeys = Array.isArray(input?.userKeys) ? input.userKeys : [];
  const tokenKeys = Array.isArray(input?.tokenKeys) ? input.tokenKeys : [];
  const logoutPaths = Array.isArray(input?.logoutPaths) ? input.logoutPaths : [];

  // 从 localStorage 解析用户 id，作为 New-Api-User 头（New API 鉴权要求，缺失会 401）
  let userId: string | null = null;
  for (const key of userKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const obj = JSON.parse(raw) as Record<string, unknown> & { data?: Record<string, unknown> };
      const id = obj?.id ?? obj?.user_id ?? obj?.data?.id ?? obj?.data?.user_id;
      if (id !== undefined && id !== null) {
        userId = String(id);
        break;
      }
    } catch {
      /* 非 JSON 或结构不符，忽略 */
    }
  }

  // 尽力而为调官方登出接口，让服务端下发空 session（无状态 session 靠这步或删 cookie 即失效）
  let logoutStatus: number | null = null;
  for (const path of logoutPaths) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (userId) headers['New-Api-User'] = userId;
      const resp = await fetch(path, { method: 'GET', credentials: 'include', headers });
      logoutStatus = resp.status;
      if (resp.ok) break;
    } catch {
      /* 网络异常忽略，继续靠清本地登录态兜底 */
    }
  }

  // 清本地登录态：前端据 localStorage.user 判断是否登录，不清会导致「仍以为已登录」
  const clearedKeys: string[] = [];
  for (const key of [...userKeys, ...tokenKeys]) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        clearedKeys.push(key);
      }
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  return { logoutStatus, clearedKeys, userId };
}
