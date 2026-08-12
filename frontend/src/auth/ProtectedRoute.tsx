import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import type { AccountRole } from "@/types/api";

export function ProtectedRoute({ requireRole }: { requireRole?: AccountRole }) {
  const { isAuthenticated, isLoading, role } = useAuth();
  const location = useLocation();
  if (isLoading) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (requireRole && role !== requireRole) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-muted-foreground">You don't have access to this area.</p>
      </div>
    );
  }
  return <Outlet />;
}
