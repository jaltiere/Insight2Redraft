import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useOwner } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFound } from "@/pages/NotFound";
import { OwnerFormDialog } from "./OwnerFormDialog";
import { isApiError } from "@/lib/api-client";

export function OwnerDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const { role } = useAuth();
  const q = useOwner(valid ? id : null);

  if (!valid) return <NotFound title="Owner not found" message="We couldn't find that owner." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Owner not found" message="We couldn't find that owner." />;
    }
    return <p className="text-destructive">Couldn't load this owner.</p>;
  }

  const owner = q.data;

  return (
    <div>
      <div className="mb-1"><Link to="/admin/owners" className="text-sm text-primary hover:underline">← Owners</Link></div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{ownerName(owner)}</h1>
        {owner.email && <span className="text-sm text-muted-foreground">{owner.email}</span>}
        {role === "super_admin" && (
          <span className="ml-auto">
            <OwnerFormDialog mode="edit" owner={owner} trigger={<Button variant="outline">Edit</Button>} />
          </span>
        )}
      </div>
      {owner.notes && <p className="mb-4 border-l-2 border-border pl-3 text-sm text-muted-foreground">{owner.notes}</p>}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sleeper links</h2>
      {owner.sleeper_links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Sleeper links yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owner.sleeper_links.map((l) => (
            <li key={`${l.season}-${l.sleeper_user_id}`} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{l.season}</span>
              <span className="font-medium">{l.sleeper_display_name ?? l.sleeper_user_id}</span>
              <Badge variant="outline" className="ml-auto">{l.sleeper_user_id}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
