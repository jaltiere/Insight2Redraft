import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { RolePill } from "@/components/RolePill";
import { visibleSections } from "@/features/adminSections";

const MOBILE_NAV_ID = "admin-mobile-nav";

export function AdminLayout() {
  const { account, role, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = [
    { to: "/admin", label: "Home", end: true },
    ...visibleSections(role).map((s) => ({ to: s.to, label: s.label, end: false })),
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-admin-rail-hover"}`;

  const identity = (
    <>
      <span className="max-w-full truncate opacity-80">{account?.email}</span>
      <RolePill role={role} />
      <button className="underline opacity-80 hover:opacity-100" onClick={logout}>
        Log out
      </button>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      {/* Mobile: the rail collapses to a top bar + a disclosure nav. */}
      <header className="flex items-center justify-between bg-admin-rail px-4 py-3 text-admin-rail-foreground sm:hidden">
        <span className="text-lg font-extrabold tracking-wide">
          I2R <span className="text-highlight">ADMIN</span>
        </span>
        <button
          type="button"
          className="p-1"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls={MOBILE_NAV_ID}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {menuOpen && (
        <nav
          id={MOBILE_NAV_ID}
          className="flex flex-col gap-1 border-t border-admin-rail-border bg-admin-rail px-2 pb-3 text-admin-rail-foreground sm:hidden"
        >
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMenuOpen(false)} className={linkClass}>
              {n.label}
            </NavLink>
          ))}
          <div className="mt-2 flex flex-col items-start gap-2 border-t border-admin-rail-border px-3 pt-3 text-xs">
            {identity}
          </div>
        </nav>
      )}

      <aside className="hidden w-56 shrink-0 flex-col bg-admin-rail text-admin-rail-foreground sm:flex">
        <div className="px-4 py-4 text-lg font-extrabold tracking-wide">
          I2R <span className="text-highlight">ADMIN</span>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start gap-2 border-t border-admin-rail-border px-4 py-3 text-xs">
          {identity}
        </div>
      </aside>
      <main className="flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
