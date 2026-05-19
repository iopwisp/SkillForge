/**
 * Tiny fetch-based API client.
 * Access/refresh tokens are stored in localStorage and sent as Bearer header.
 * On 401, we attempt a one-time refresh-token rotation, then retry.
 */

export const API_URL =
  (typeof window !== "undefined" && (window as any).__API_URL__) ||
  (import.meta as any).env?.VITE_API_URL ||
  "http://localhost:4000/api";

const STORAGE_ACCESS  = "skillforge.access_token";
const STORAGE_REFRESH = "skillforge.refresh_token";

export const tokens = {
  get access()  { return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_ACCESS)  : null; },
  get refresh() { return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_REFRESH) : null; },
  set(access: string, refresh: string) {
    localStorage.setItem(STORAGE_ACCESS,  access);
    localStorage.setItem(STORAGE_REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(STORAGE_ACCESS);
    localStorage.removeItem(STORAGE_REFRESH);
  },
};

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const refreshToken = tokens.refresh;
      if (!refreshToken) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) { tokens.clear(); return false; }
      const data = await res.json();
      if (data.accessToken && data.refreshToken) {
        tokens.set(data.accessToken, data.refreshToken);
        return true;
      }
      tokens.clear();
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: any;
  auth?: boolean;  // set to false to skip Authorization header
  raw?: boolean;   // return Response instead of JSON
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  // Attach Bearer token unless explicitly opted out
  if (opts.auth !== false && tokens.access) {
    headers.set("Authorization", `Bearer ${tokens.access}`);
  }
  const init: RequestInit = {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    credentials: "include",
    body: opts.body !== undefined
      ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body))
      : undefined,
  };

  let res = await fetch(url, init);

  // On 401, try to silently rotate the refresh token, then retry once
  if (res.status === 401 && opts.auth !== false) {
    const ok = await tryRefresh();
    if (ok) {
      // Rebuild headers with the new access token
      const retryHeaders = new Headers(init.headers as Headers);
      if (tokens.access) retryHeaders.set("Authorization", `Bearer ${tokens.access}`);
      res = await fetch(url, { ...init, headers: retryHeaders });
    }
  }

  if (opts.raw) return res as any;

  const text = await res.text();
  let json: any = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  if (!res.ok) {
    const msg = (json && typeof json === "object" && "error" in json) ? json.error : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, json);
  }
  return json as T;
}
