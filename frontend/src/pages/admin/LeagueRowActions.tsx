import { useState } from "react";
import { Link } from "react-router-dom";
import { useDeleteLeague, useSyncLeague } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { LeagueSetupDialog } from "./LeagueSetupDialog";
import type { SyncNowResponse } from "@/types/api";

export function LeagueRowActions({
  seasonId, leagueId, leagueName, canManage, canSync,
}: {
  seasonId: number; leagueId: number; leagueName: string; canManage: boolean; canSync: boolean;
}) {
  const sync = useSyncLeague(seasonId);
  const del = useDeleteLeague(seasonId);
  const [syncResult, setSyncResult] = useState<SyncNowResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onSync() {
    setSyncError(null); setSyncResult(null);
    try {
      setSyncResult(await sync.mutateAsync(leagueId));
    } catch (e) {
      setSyncError(isApiError(e) ? e.detail : "Sync failed");
    }
  }

  async function onDelete() {
    setDeleteError(null);
    try {
      await del.mutateAsync(leagueId);
      setConfirmOpen(false);
    } catch (e) {
      setDeleteError(isApiError(e) ? e.detail : "Delete failed");
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {syncResult && (
        <span className="text-xs text-muted-foreground">
          Week {syncResult.week} · {syncResult.teams_synced} synced · {syncResult.mismatches} mismatches
        </span>
      )}
      {syncError && <span className="text-xs text-destructive">{syncError}</span>}
      <Button asChild variant="outline" size="sm">
        <Link to={`/admin/leagues/${leagueId}/mapping`}>Map owners</Link>
      </Button>
      {canSync && (
        <Button variant="outline" size="sm" onClick={onSync} disabled={sync.isPending}>Sync now</Button>
      )}
      {canManage && (
        <LeagueSetupDialog
          mode="resync" seasonId={seasonId} leagueId={leagueId}
          trigger={<Button variant="outline" size="sm">Resync</Button>}
        />
      )}
      {canManage && (
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => { setConfirmOpen(o); setDeleteError(null); }}
        >
          <DialogTrigger asChild><Button variant="destructive" size="sm">Delete</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {leagueName}?</DialogTitle>
              <DialogDescription>This removes the league and its data from the season.</DialogDescription>
            </DialogHeader>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
