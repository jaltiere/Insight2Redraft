import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { LeagueStandingsCard } from "@/components/LeagueStandingsCard";
import { StatChip } from "@/components/StatChip";
import { useSeasons } from "@/features/useSeasons";
import { useLeagues, useSeason } from "@/features/useSeasonDashboard";
import type { SeasonStatus } from "@/types/api";

const STATUS_LABEL: Record<SeasonStatus, string> = {
  setup: "Setup",
  regular: "Regular season",
  playoffs: "Playoffs",
  complete: "Complete",
};

export function DashboardPage() {
  const seasonsQ = useSeasons();
  const seasons = seasonsQ.data;
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const latestYear = useMemo(
    () => (seasons && seasons.length ? Math.max(...seasons.map((s) => s.year)) : null),
    [seasons],
  );
  const year = selectedYear ?? latestYear;
  const selected = seasons?.find((s) => s.year === year) ?? null;

  const seasonQ = useSeason(selected?.id ?? null);
  const leagues = seasonQ.data?.leagues ?? [];
  const leagueQs = useLeagues(leagues.map((l) => l.id));

  if (seasonsQ.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (seasonsQ.isError) return <p className="text-destructive">Couldn't load seasons.</p>;
  if (!seasons || seasons.length === 0 || !selected) {
    return <p className="text-muted-foreground">No seasons yet.</p>;
  }

  const teamCount = leagueQs.reduce((n, q) => n + (q.data?.standings.length ?? 0), 0);
  const showBracket = selected.status === "playoffs" || selected.status === "complete";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Season {selected.year}</h1>
            <Badge>{STATUS_LABEL[selected.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Standings across every league, at a glance.</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Season</span>
          <select
            aria-label="Season"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={selected.year}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.year}>
                {s.year}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatChip>
          {leagues.length} {leagues.length === 1 ? "league" : "leagues"}
        </StatChip>
        {teamCount > 0 && <StatChip>{teamCount} teams</StatChip>}
        {showBracket && (
          <Link
            to={`/seasons/${selected.id}/bracket`}
            className="rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            View the bracket →
          </Link>
        )}
      </div>

      {seasonQ.isPending ? (
        <p className="text-muted-foreground">Loading leagues…</p>
      ) : seasonQ.isError ? (
        <p className="text-destructive">Couldn't load this season.</p>
      ) : leagues.length === 0 ? (
        <p className="text-muted-foreground">No leagues in this season yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {leagueQs.map((q, i) =>
            q.data ? (
              <LeagueStandingsCard key={leagues[i].id} league={q.data} />
            ) : (
              <div
                key={leagues[i].id}
                className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
              >
                {q.isError ? `Couldn't load ${leagues[i].name}.` : `Loading ${leagues[i].name}…`}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
