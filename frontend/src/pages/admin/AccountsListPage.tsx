import { Link } from "react-router-dom";
import { useAccounts } from "@/features/adminAccounts";
import { RolePill } from "@/components/RolePill";
import { Button } from "@/components/ui/button";
import { AccountFormDialog } from "./AccountFormDialog";
import type { AccountAdminResponse } from "@/types/api";

function grantLabel(a: AccountAdminResponse): string {
  if (a.role === "super_admin") return "—";
  return a.grants.length === 1 ? "1 league" : `${a.grants.length} leagues`;
}

export function AccountsListPage() {
  const accounts = useAccounts();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <AccountFormDialog trigger={<Button>New account</Button>} />
      </div>
      {accounts.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : accounts.isError ? (
        <p className="text-destructive">Couldn't load accounts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.data.map((a) => (
            <li key={a.id}>
              <Link
                to={`/admin/accounts/${a.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary"
              >
                <span className="font-medium">{a.email}</span>
                <span className="flex items-center gap-3">
                  <RolePill role={a.role} />
                  <span className="text-sm text-muted-foreground">{grantLabel(a)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
