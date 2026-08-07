import { Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

export function AdminLayout() {
  const { account, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-bold">Admin</span>
        <div className="flex items-center gap-3">
          <span className="text-sm">{account?.email}</span>
          <button className="text-sm underline" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
