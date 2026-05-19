import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, tokens } from "./api";
import type { AuthResponse, User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (emailOrUsername: string, password: string) => Promise<User>;
  register: (data: { username: string; email: string; password: string; fullName?: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<User | null>;
  setSession: (resp: AuthResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setState({ user: me, loading: false, error: null });
      return me;
    } catch (e) {
      setState({ user: null, loading: false, error: null });
      return null;
    }
  }, []);

  useEffect(() => {
    // Only attempt to load user if we have a stored access token
    if (tokens.access) {
      refreshMe();
    } else {
      setState({ user: null, loading: false, error: null });
    }
  }, [refreshMe]);

  const setSession = useCallback((resp: AuthResponse) => {
    // Persist tokens from a login/register/OAuth response
    if (resp.accessToken && resp.refreshToken) {
      tokens.set(resp.accessToken, resp.refreshToken);
    }
    setState({ user: resp.user, loading: false, error: null });
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await api<AuthResponse>("/auth/login", { body: { emailOrUsername, password }, auth: false });
      tokens.set(r.accessToken, r.refreshToken);
      setState({ user: r.user, loading: false, error: null });
      return r.user;
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : "Login failed";
      setState(s => ({ ...s, loading: false, error: msg }));
      throw e;
    }
  }, []);

  const register = useCallback(async (data: { username: string; email: string; password: string; fullName?: string }) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await api<AuthResponse>("/auth/register", { body: data, auth: false });
      tokens.set(r.accessToken, r.refreshToken);
      setState({ user: r.user, loading: false, error: null });
      return r.user;
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : "Registration failed";
      setState(s => ({ ...s, loading: false, error: msg }));
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokens.refresh;
    tokens.clear();
    setState({ user: null, loading: false, error: null });
    try {
      await api("/auth/logout", {
        method: "POST",
        auth: false,
        body: refreshToken ? { refreshToken } : undefined,
      });
    } catch {}
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state, login, register, logout, refreshMe, setSession,
  }), [state, login, register, logout, refreshMe, setSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
