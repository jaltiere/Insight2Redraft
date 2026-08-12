import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

const SECTIONS = [
  { to: "/admin/seasons", title: "Seasons", desc: "Create & edit seasons, add leagues, sync, brackets." },
  { to: "/admin/owners", title: "Owners", desc: "Owner records & per-team mapping." },
  { to: "/admin/accounts", title: "Accounts", desc: "League-admin accounts & league grants.", superOnly: true },
] as const;

export function AdminHome() {
  const { account, role } = useAuth();
  const sections = SECTIONS.filter((s) => !("superOnly" in s && s.superOnly) || role === "super_admin");

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
            <h2 className="font-semibold text-primary">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
