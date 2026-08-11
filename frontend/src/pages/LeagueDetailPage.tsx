import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PointsBar } from "@/components/PointsBar";
import { Badge } from "@/components/ui/badge";
import { NotFound } from "@/pages/NotFound";
import { useLeague } from "@/features/useLeagueDetail";
import { ownerName, ordinal, teamRecord } from "@/features/standings";
import { isApiError } from "@/lib/api-client";

export function LeagueDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const q = useLeague(valid ? id : null);

  if (!valid) return <NotFound title="League not found" message="We couldn't find that league." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="League not found" message="We couldn't find that league." />;
    }
    return <p className="text-destructive">Couldn't load this league.</p>;
  }

  const league = q.data;
  const maxPf = Math.max(1, ...league.standings.map((s) => s.points_for));

  return (
    <div>
      <div className="mb-4">
        <Link to="/" className="text-sm text-primary hover:underline">← Back to dashboard</Link>
      </div>
      <PageHeader
        title={league.name}
        description={`Season ${league.season_year}`}
        actions={
          <Badge variant={league.scoring_validated ? "secondary" : "outline"}>
            {league.scoring_validated ? "Scoring ✓" : "Unverified"}
          </Badge>
        }
      />
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Record</th>
              <th className="px-4 py-2 font-medium">Points for</th>
              <th className="px-4 py-2 font-medium">Points against</th>
              <th className="px-4 py-2 font-medium">Finish</th>
              <th className="px-4 py-2"><span className="sr-only">Team detail</span></th>
            </tr>
          </thead>
          <tbody>
            {league.standings.map((s, i) => (
              <tr key={s.team_id} className={i === 0 ? "border-t bg-primary/5" : "border-t"}>
                <td className="px-4 py-2">
                  {i === 0 ? (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                  )}
                </td>
                <td className="px-4 py-2 font-medium">
                  {s.owner ? (
                    <Link to={`/owners/${s.owner.id}`} className="hover:text-primary hover:underline">{ownerName(s.owner)}</Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">{teamRecord(s)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <PointsBar value={s.points_for} max={maxPf} />
                    <span className="tabular-nums text-muted-foreground">{s.points_for.toLocaleString("en-US")}</span>
                  </div>
                </td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">{s.points_against.toLocaleString("en-US")}</td>
                <td className="px-4 py-2">
                  {s.league_finish != null ? (
                    <Badge variant="outline">{ordinal(s.league_finish)}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    to={`/teams/${s.team_id}`}
                    aria-label={`View team detail for ${ownerName(s.owner)}`}
                    className="text-primary hover:underline"
                  >
                    →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
