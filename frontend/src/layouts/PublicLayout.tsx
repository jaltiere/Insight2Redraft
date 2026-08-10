import { Link, NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { to: "/", label: "Seasons", end: true },
  { to: "/leagues", label: "Leagues" },
  { to: "/bracket", label: "Bracket" },
  { to: "/records", label: "Records" },
];

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight">
              <span className="text-primary">Insight</span>2Redraft
            </Link>
            <nav className="hidden items-center gap-4 text-sm sm:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          Insight2Redraft — cross-league fantasy, one bracket.
        </div>
      </footer>
    </div>
  );
}
