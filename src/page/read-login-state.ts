/**
 * 页面注入函数：探测 NewAPI 浏览器登录态。
 * 自包含，运行在页面上下文。移植自 reference/background.js inspectNewApiBrowserSession。
 */
export interface BrowserSessionInfo {
  success: boolean;
  hasUser: boolean;
  user: string | null;
  token: string | null;
  userAuthenticated: boolean;
  selfStatus: number;
  error?: string;
}

export async function inspectBrowserSession(): Promise<BrowserSessionInfo> {
  try {
    const user = localStorage.getItem('user');
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('auth_token');
    let selfStatus = 0;
    let userAuthenticated = false;

    try {
      const selfResp = await fetch('/api/user/self', { credentials: 'include' });
      selfStatus = selfResp.status;
      const selfData = await selfResp.json();
      userAuthenticated =
        selfResp.ok &&
        selfStatus !== 401 &&
        selfData?.success !== false &&
        Boolean(selfData?.data || selfData?.success === true);
    } catch {
      /* ignore */
    }

    return {
      success: true,
      hasUser: user !== null,
      user,
      token,
      userAuthenticated,
      selfStatus,
    };
  } catch (e) {
    return {
      success: false,
      hasUser: false,
      user: null,
      token: null,
      userAuthenticated: false,
      selfStatus: 0,
      error: (e as Error).message,
    };
  }
}

export function hasUserSession(session: BrowserSessionInfo | null): boolean {
  return Boolean(session?.userAuthenticated || session?.hasUser);
}
