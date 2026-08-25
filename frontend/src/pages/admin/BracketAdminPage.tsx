import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useAdminBracket, useApproveBracket, useFinalizeRound, useGenerateBracket,
} from "@/features/adminBracket";
import { useSeason } from "@/features/useSeasonDashboard";
import { groupByRound, roundCount } from "@/features/bracket";
import { ownerName } from "@/features/standings";
import { BracketRounds } from "@/components/BracketRounds";
import { NotFound } from "@/pages/NotFound";
import { isApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function BracketAdminPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const navigate = useNavigate();

  const season = useSeason(valid ? id : null);
  const bracket = useAdminBracket(valid ? id : null);
  const generate = useGenerateBracket(valid ? id : 0);
  const approve = useApproveBracket(valid ? id : 0);
  const finalize = useFinalizeRound(valid ? id : 0);

  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!valid) return <NotFound title="Season not found" message="We couldn't find that season." />;
  if (bracket.isPending || season.isPending) return <p className="text-muted-foreground">Loading…</p>;

  const missing = bracket.isError && isApiError(bracket.error) && bracket.error.status === 404;
  if (bracket.isError && !missing) {
    return <p className="text-destructive">Couldn't load the bracket.</p>;
  }

  const inPlayoffs = season.data?.status === "playoffs";

  async function onGenerate() {
    setError(null);
    try {
      await generate.mutateAsync();
      setConfirmGenerate(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Generate failed");
    }
  }

  async function onApprove() {
    setError(null);
    try {
      await approve.mutateAsync();
      setConfirmApprove(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Approve failed");
    }
  }

  async function onFinalize() {
    setError(null);
    try {
      await finalize.mutateAsync();
      setConfirmFinalize(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Finalize failed");
    }
  }

  const isPending = !missing && bracket.data!.status === "pending";
  const roundsNeeded = missing ? 0 : roundCount(bracket.data!.matchups);
  const weeks = season.data?.nfl_playoff_weeks.length ?? 0;
  const tooFewWeeks = isPending && roundsNeeded > weeks;
  const grouped = missing ? [] : groupByRound(bracket.data!.matchups);
  const isActive = !missing && bracket.data!.status === "active";
  const isComplete = !missing && bracket.data!.status === "complete";
  const nextRound = grouped.find((r) => r.matchups.some((m) => !m.is_finalized)) ?? null;
  const champion = isComplete
    ? grouped[grouped.length - 1]?.matchups[0]?.winner_team_id ?? null
    : null;

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Bracket{season.data ? ` · ${season.data.year}` : ""}
        </h1>
        {!missing && <Badge variant="secondary">{bracket.data!.status}</Badge>}
      </div>

      {missing ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
          <p className="font-medium">No bracket yet.</p>
          {!inPlayoffs && (
            <p className="text-sm text-muted-foreground">
              The season must be in playoffs before a bracket can be generated.
            </p>
          )}
          <Button disabled={!inPlayoffs} onClick={() => setConfirmGenerate(true)}>
            Generate bracket
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-6 overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Seed</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">League</th>
                  <th className="px-4 py-2 font-medium">Qualified via</th>
                </tr>
              </thead>
              <tbody>
                {bracket.data!.seeds.map((s) => (
                  <tr key={s.team_id} className="border-t">
                    <td className="px-4 py-2 tabular-nums">{s.seed}</td>
                    <td className="px-4 py-2 font-medium">{ownerName(s.owner)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.league_name}</td>
                    <td className="px-4 py-2">{s.qualified_via}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BracketRounds rounds={grouped} championTeamId={champion} />
          {isPending && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => setConfirmGenerate(true)}>Regenerate</Button>
              <Button onClick={() => setConfirmApprove(true)}>Approve bracket</Button>
            </div>
          )}
          {isActive && nextRound && (
            <div className="mt-4">
              <Button onClick={() => setConfirmFinalize(true)}>Finalize round</Button>
            </div>
          )}
        </>
      )}

      {error && !confirmGenerate && !confirmApprove && !confirmFinalize && (
        <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>
      )}

      <Dialog
        open={confirmGenerate}
        onOpenChange={(o) => { setConfirmGenerate(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate the bracket?</DialogTitle>
            <DialogDescription>
              {missing
                ? "Builds the playoff field from current standings. You can review it before approving."
                : "The existing draft bracket will be discarded and replaced with a new one built from current standings."}
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onGenerate} disabled={generate.isPending}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmApprove}
        onOpenChange={(o) => { setConfirmApprove(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this bracket?</DialogTitle>
            <DialogDescription>
              Approving publishes the bracket publicly and starts the playoffs. This can't be
              undone — regenerate now if the field looks wrong.
            </DialogDescription>
          </DialogHeader>
          {tooFewWeeks && (
            <p className="text-sm text-highlight">
              ⚠ This bracket needs {roundsNeeded} rounds but the season has more rounds than playoff
              weeks ({weeks} configured). Finalizing the later rounds will fail until you add weeks.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onApprove} disabled={approve.isPending}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmFinalize}
        onOpenChange={(o) => { setConfirmFinalize(o); if (o) setError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Finalize round {nextRound?.round} · week {nextRound?.nfl_week}?
            </DialogTitle>
            <DialogDescription>
              Locks this round's scores, advances the winners, and creates the next round.
              This can't be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={onFinalize} disabled={finalize.isPending}>Finalize</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
