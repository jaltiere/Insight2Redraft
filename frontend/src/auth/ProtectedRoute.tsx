import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import type { AccountRole } from "@/types/api";

export function ProtectedRoute({ requireRole }: { requireRole?: AccountRole }) {
  const { isAuthenticated, isLoading, role } = useAuth();
  if (isLoading) return <p>Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (requireRole && role !== requireRole) return <p>Not authorized.</p>;
  return <Outlet />;
}
