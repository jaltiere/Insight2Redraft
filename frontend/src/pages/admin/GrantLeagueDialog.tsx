import { useState } from "react";
import { useAdminLeagues, useGrantLeague } from "@/features/adminAccounts";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { LeagueGrantRef } from "@/types/api";

export function GrantLeagueDialog({
  accountId, existing,
}: {
  accountId: number; existing: LeagueGrantRef[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const leagues = useAdminLeagues(open);
  const grant = useGrantLeague(accountId);

  const held = new Set(existing.map((g) => g.league_id));
  const term = q.trim().toLowerCase();
  const rows = (leagues.data ?? []).filter(
    (l) => term === "" || l.name.toLowerCase().includes(term) || String(l.season_year).includes(term),
  );

  async function pick(leagueId: number) {
    setError(null);
    try {
      await grant.mutateAsync(leagueId);
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Grant failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) { setQ(""); setError(null); } }}
    >
      <DialogTrigger asChild><Button variant="outline" size="sm">Grant league</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant a league</DialogTitle>
          <DialogDescription>
            Gives this account admin rights on one league. Leagues it already holds are disabled.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          placeholder="Search leagues…"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-64 overflow-y-auto rounded-md border bg-card">
          {leagues.isPending ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No leagues match.</p>
          ) : (
            rows.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={held.has(l.id) || grant.isPending}
                onClick={() => pick(l.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span>{l.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {l.season_year}{held.has(l.id) ? " · granted" : ""}
                </span>
              </button>
            ))
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
