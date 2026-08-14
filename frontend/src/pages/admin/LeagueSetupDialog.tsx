import { useState } from "react";
import type { ReactNode } from "react";
import { useAddLeague, useResyncLeague } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { LeagueSetupResponse } from "@/types/api";

type Props =
  | { mode: "add"; seasonId: number; trigger: ReactNode }
  | { mode: "resync"; seasonId: number; leagueId: number; trigger: ReactNode };

export function LeagueSetupDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [sleeperId, setSleeperId] = useState("");
  const [result, setResult] = useState<LeagueSetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = useAddLeague(props.seasonId);
  const resync = useResyncLeague(props.seasonId);
  const pending = add.isPending || resync.isPending;

  function reset() {
    setSleeperId(""); setResult(null); setError(null);
  }

  async function run() {
    setError(null);
    try {
      const res = props.mode === "add"
        ? await add.mutateAsync(sleeperId)
        : await resync.mutateAsync(props.leagueId);
      setResult(res);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Setup failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); reset(); }}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mode === "add" ? "Add league" : "Resync league"}</DialogTitle>
          <DialogDescription>
            Pulls rosters and validates scoring against the season ruleset.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{result.name}</span>
              <Badge variant="secondary">{props.mode === "add" ? "Added" : "Resynced"}</Badge>
              {result.scoring_validated
                ? <Badge variant="secondary">✓ scoring valid</Badge>
                : <Badge variant="outline">⚠ scoring differs</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{result.teams.length} teams imported.</p>
            {result.diffs.length > 0 && (
              <table className="mt-1 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Category</th>
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 font-medium">Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {result.diffs.map((d) => (
                    <tr key={d.category} className="border-t">
                      <td className="py-1">{d.category}</td>
                      <td className="py-1 tabular-nums">{d.league_value}</td>
                      <td className="py-1 tabular-nums">{d.platform_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!result.scoring_validated && (
              <p className="text-xs text-muted-foreground">
                {props.mode === "add" ? "Added" : "Resynced"} regardless — this flag is advisory. Fix the season ruleset then Resync, or leave as-is.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {props.mode === "add" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Sleeper league ID</span>
                <Input value={sleeperId} onChange={(e) => setSleeperId(e.target.value)} />
              </label>
            )}
            {props.mode === "resync" && (
              <p className="text-sm text-muted-foreground">Re-run setup sync for this league?</p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <DialogClose asChild><Button>Done</Button></DialogClose>
          ) : (
            <>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                onClick={run}
                disabled={pending || (props.mode === "add" && sleeperId.trim() === "")}
              >
                {pending ? "Working…" : props.mode === "add" ? "Add" : "Resync"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
