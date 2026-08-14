import { useState } from "react";
import { Link } from "react-router-dom";
import { useOwners } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";

export function OwnersListPage() {
  const [q, setQ] = useState("");
  const owners = useOwners(q);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Owners</h1>
        <OwnerFormDialog mode="create" trigger={<Button>New owner</Button>} />
      </div>
      <Input className="mb-4 max-w-sm" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      {owners.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : owners.isError ? (
        <p className="text-destructive">Couldn't load owners.</p>
      ) : owners.data.length === 0 ? (
        <p className="text-muted-foreground">No owners match.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {owners.data.map((o) => (
            <li key={o.id}>
              <Link to={`/admin/owners/${o.id}`} className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary">
                <span className="font-medium">{ownerName(o)}</span>
                <span className="text-sm text-muted-foreground">{o.email ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
