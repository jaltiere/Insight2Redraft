import { useState } from "react";
import { useAssignTeamOwner, useOwners } from "@/features/adminOwners";
import { useDebounced } from "@/lib/useDebounced";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";
import type { OwnerRef } from "@/types/api";

export function OwnerPicker({
  leagueId, teamId, sleeperName, current,
}: {
  leagueId: number; teamId: number; sleeperName: string | null; current: OwnerRef | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [assigned, setAssigned] = useState<OwnerRef | null>(current);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(text, 250);
  const results = useOwners(q, open);
  const assign = useAssignTeamOwner(leagueId);

  async function pick(ownerId: number) {
    setError(null);
    try {
      const row = await assign.mutateAsync({ teamId, ownerId });
      setAssigned(row.owner);
      setOpen(false); setText("");
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Assign failed");
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {assigned ? (
          <span className="font-medium text-foreground">{ownerName(assigned)}</span>
        ) : (
          <span className="text-highlight">⚠ Unassigned</span>
        )}
        <Button variant="link" size="sm" onClick={() => setOpen(true)}>{assigned ? "change" : "assign"}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input autoFocus value={text} placeholder="Search owners…" onChange={(e) => setText(e.target.value)} />
      <div className="rounded-md border bg-card">
        {results.data?.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => pick(o.id)}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {ownerName(o)}{o.email ? <span className="text-muted-foreground"> · {o.email}</span> : null}
          </button>
        ))}
        <OwnerFormDialog
          mode="create"
          prefillFirstName={sleeperName ?? ""}
          onCreated={(o) => pick(o.id)}
          trigger={
            <button type="button" className="block w-full px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted">
              ＋ Create {sleeperName ? `"${sleeperName}"` : "new owner"}
            </button>
          }
        />
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
    </div>
  );
}
