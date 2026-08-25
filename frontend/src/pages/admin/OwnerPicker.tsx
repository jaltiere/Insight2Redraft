import { useState } from "react";
import { useAssignTeamOwner } from "@/features/adminOwners";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { OwnerCombobox } from "./OwnerCombobox";
import type { OwnerRef } from "@/types/api";

export function OwnerPicker({
  leagueId, teamId, sleeperName, current,
}: {
  leagueId: number; teamId: number; sleeperName: string | null; current: OwnerRef | null;
}) {
  const [open, setOpen] = useState(false);
  const [assigned, setAssigned] = useState<OwnerRef | null>(current);
  const [error, setError] = useState<string | null>(null);
  const assign = useAssignTeamOwner(leagueId);

  async function pick(ownerId: number) {
    setError(null);
    try {
      const row = await assign.mutateAsync({ teamId, ownerId });
      setAssigned(row.owner);
      setOpen(false);
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
        <Button variant="link" size="sm" onClick={() => setOpen(true)}>
          {assigned ? "change" : "assign"}
        </Button>
      </div>
    );
  }

  return (
    <OwnerCombobox
      sleeperName={sleeperName}
      onSelect={(o) => pick(o.id)}
      onCancel={() => setOpen(false)}
      error={error}
    />
  );
}
