import { useContext } from "react";
import { AuthContext } from "@/auth/AuthProvider";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return {
    account: ctx.account,
    role: ctx.account?.role ?? null,
    isAuthenticated: ctx.account !== null,
    isLoading: ctx.isLoading,
    login: ctx.login,
    logout: ctx.logout,
  };
}
