import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { RolePill } from "@/components/RolePill";
import { visibleSections } from "@/features/adminSections";

export function AdminLayout() {
  const { account, role, logout } = useAuth();
  const items = [
    { to: "/admin", label: "Home", end: true },
    ...visibleSections(role).map((s) => ({ to: s.to, label: s.label, end: false })),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-admin-rail text-admin-rail-foreground">
        <div className="px-4 py-4 text-lg font-extrabold tracking-wide">
          I2R <span className="text-highlight">ADMIN</span>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-white/10"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start gap-2 border-t border-white/10 px-4 py-3 text-xs">
          <span className="max-w-full truncate opacity-80">{account?.email}</span>
          <RolePill role={role} />
          <button className="underline opacity-80 hover:opacity-100" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
