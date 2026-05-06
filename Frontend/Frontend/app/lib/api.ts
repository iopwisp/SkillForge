/**
 * Tiny fetch-based API client.
 * Tokens are stored in localStorage and attached to every request.
 * On 401, we attempt a one-time refresh-token rotation, then retry.
 */

export const API_URL =
  (typeof window !== "undefined" && (window as any).__API_URL__) ||
  (import.meta as any).env?.VITE_API_URL ||
  "http://localhost:4000/api";

const ACCESS_KEY = "skillforge.accessToken";
const REFRESH_KEY = "skillforge.refreshToken";

export const tokens = {
  get access() { return safeGet(ACCESS_KEY); },
  get refresh() { return safeGet(REFRESH_KEY); },
  set(access: string | null, refresh: string | null) {
    if (typeof window === "undefined") return;
    if (access)  localStorage.setItem(ACCESS_KEY,  access);  else localStorage.removeItem(ACCESS_KEY);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh); else localStorage.removeItem(REFRESH_KEY);
  },
  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

function safeGet(k: string) {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(k);
}

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
  const refresh = tokens.refresh;
  if (!refresh) return false;
  refreshing = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) {
        tokens.clear();
        return false;
      }
      const data = await res.json();
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      tokens.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: any;
  auth?: boolean;        // default: true if access token present
  raw?: boolean;         // return Response instead of JSON
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const includeAuth = opts.auth !== false && !!tokens.access;
  if (includeAuth) headers.set("Authorization", `Bearer ${tokens.access}`);

  const init: RequestInit = {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined
      ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body))
      : undefined,
  };

  let res = await fetch(url, init);
  if (res.status === 401 && includeAuth) {
    const ok = await tryRefresh();
    if (ok) {
      headers.set("Authorization", `Bearer ${tokens.access}`);
      res = await fetch(url, { ...init, headers });
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
