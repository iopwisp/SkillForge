/**
 * Tiny fetch-based API client.
 * Tokens are stored in localStorage and attached to every request.
 * On 401, we attempt a one-time refresh-token rotation, then retry.
 */

export const API_URL =
  (typeof window !== "undefined" && (window as any).__API_URL__) ||
  (import.meta as any).env?.VITE_API_URL ||
  "http://localhost:4000/api";

// Tokens are stored securely in HttpOnly cookies by the backend.
// We just need to send credentials with every request.

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
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      return res.ok;
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
  auth?: boolean;
  raw?: boolean;         // return Response instead of JSON
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
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
  if (res.status === 401 && opts.auth !== false) {
    const ok = await tryRefresh();
    if (ok) {
      res = await fetch(url, init);
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
