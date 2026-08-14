import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { visibleSections } from "@/features/adminSections";

export function AdminHome() {
  const { account, role } = useAuth();
  const sections = visibleSections(role);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {account?.email}. Manage seasons, owners, and accounts.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary"
          >
            <h2 className="font-semibold text-primary">{s.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
