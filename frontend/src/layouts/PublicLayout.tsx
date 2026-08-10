import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { to: "/", label: "Seasons", end: true },
  { to: "/leagues", label: "Leagues" },
  { to: "/bracket", label: "Bracket" },
  { to: "/records", label: "Records" },
];

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-muted/40 text-foreground">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight" onClick={() => setMenuOpen(false)}>
              Insight2Redraft
            </Link>
            <nav className="hidden items-center gap-4 text-sm sm:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? "font-medium" : "text-primary-foreground/70 hover:text-primary-foreground"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              className="p-2 sm:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-primary-foreground/20 px-4 py-2 sm:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block py-2 text-sm ${isActive ? "font-medium" : "text-primary-foreground/80"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          Insight2Redraft — cross-league fantasy, one bracket.
        </div>
      </footer>
    </div>
  );
}
