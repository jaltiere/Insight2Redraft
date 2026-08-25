import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateSeason, useUpdateSeason } from "@/features/adminSeasons";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { SeasonDetail, SeasonStatus } from "@/types/api";

const STATUSES: SeasonStatus[] = ["setup", "regular", "playoffs", "complete"];

function parseWeeks(s: string): number[] {
  return s.split(",").map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

function isPositiveInt(s: string): boolean {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n > 0;
}

/** Empty is allowed (a season may have no playoff weeks yet); junk is not. */
function weeksValid(s: string): boolean {
  if (s.trim() === "") return true;
  return s.split(",").every((part) => isPositiveInt(part));
}

/**
 * Returns the first problem with the form, or null when it's submittable.
 * Guards the inputs that would otherwise send 0/NaN and get a 422 back.
 */
function seasonFormError(
  { year, field, weeks }: { year: string; field: string; weeks: string },
  editing: boolean,
): string | null {
  if (!editing && !isPositiveInt(year)) return "Year must be a whole number.";
  if (!editing && (Number(year) < 1900 || Number(year) > 2200)) return "Year looks out of range.";
  if (!isPositiveInt(field)) return "Playoff teams per league must be a whole number above 0.";
  if (!weeksValid(weeks)) return "NFL playoff weeks must be whole numbers, comma-separated.";
  return null;
}

export function SeasonFormDialog({ trigger, season }: { trigger: ReactNode; season?: SeasonDetail }) {
  const editing = season !== undefined;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(season ? String(season.year) : "");
  const [status, setStatus] = useState<SeasonStatus>(season?.status ?? "setup");
  const [field, setField] = useState(String(season?.playoff_field_per_league ?? 2));
  const [weeks, setWeeks] = useState((season?.nfl_playoff_weeks ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSeason();
  const update = useUpdateSeason(season?.id ?? 0);
  const pending = create.isPending || update.isPending;
  const invalid = seasonFormError({ year, field, weeks }, editing);

  function reset() {
    setYear(season ? String(season.year) : "");
    setStatus(season?.status ?? "setup");
    setField(String(season?.playoff_field_per_league ?? 2));
    setWeeks((season?.nfl_playoff_weeks ?? []).join(", "));
    setError(null);
  }

  async function onSubmit() {
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          status,
          playoff_field_per_league: Number(field),
          nfl_playoff_weeks: parseWeeks(weeks),
        });
      } else {
        await create.mutateAsync({
          year: Number(year),
          status,
          playoff_field_per_league: Number(field),
          nfl_playoff_weeks: parseWeeks(weeks),
        });
      }
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Save failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit season ${season.year}` : "New season"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update this season's settings." : "Create a season, then add its leagues."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Year</span>
            <Input value={year} disabled={editing} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              className="rounded-md border bg-background px-2 py-1"
              value={status}
              onChange={(e) => setStatus(e.target.value as SeasonStatus)}
            >
              {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Playoff teams per league</span>
            <Input value={field} onChange={(e) => setField(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">NFL playoff weeks</span>
            <Input value={weeks} placeholder="15, 16, 17" onChange={(e) => setWeeks(e.target.value)} />
          </label>
          {invalid && <p className="text-sm text-muted-foreground">{invalid}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={pending || invalid !== null}>
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
