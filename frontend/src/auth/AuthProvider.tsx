import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiClient } from "@/lib/api-client";
import { clearToken, getToken, setToken, subscribeToken } from "@/auth/token";
import { queryClient } from "@/lib/queryClient";
import type { Account } from "@/types/api";

interface AuthContextValue {
  account: Account | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

// AuthContext lives here (not a separate file) so useAuth can import it directly.
// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      if (!getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await apiClient.get<Account>("/auth/me");
        if (active) setAccount(me);
      } catch {
        clearToken();
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  // A mid-session 401 (or explicit logout) clears the token via the api-client;
  // when the token goes null, drop the cached account + queries so ProtectedRoute
  // redirects to login instead of showing a stuck "authenticated" state.
  useEffect(() => {
    return subscribeToken((token) => {
      if (token === null) {
        setAccount(null);
        queryClient.clear();
      }
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.post<{ access_token: string }>("/auth/login", { email, password });
    setToken(res.access_token);
    const me = await apiClient.get<Account>("/auth/me");
    setAccount(me);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAccount(null);
  }, []);

  const value = useMemo(() => ({ account, isLoading, login, logout }), [account, isLoading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
