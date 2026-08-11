import { Link, useParams } from "react-router-dom";
import { StatChip } from "@/components/StatChip";
import { WeeklyBarChart } from "@/components/WeeklyBarChart";
import { Badge } from "@/components/ui/badge";
import { NotFound } from "@/pages/NotFound";
import { useTeam } from "@/features/useLeagueDetail";
import { ownerName, ordinal, teamRecord } from "@/features/standings";
import { isApiError } from "@/lib/api-client";

export function TeamDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const q = useTeam(valid ? id : null);

  if (!valid) return <NotFound title="Team not found" message="We couldn't find that team." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Team not found" message="We couldn't find that team." />;
    }
    return <p className="text-destructive">Couldn't load this team.</p>;
  }

  const team = q.data;

  return (
    <div>
      <div className="mb-4">
        <span className="text-sm text-primary">
          ← <Link to={`/leagues/${team.league_id}`} className="hover:underline">{team.league_name}</Link>
        </span>
      </div>

      <div className="mb-6 flex items-center gap-4">
        {team.owner?.avatar_url ? (
          <img src={team.owner.avatar_url} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {team.owner ? ownerName(team.owner).slice(0, 1) : "—"}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {team.owner ? (
              <Link to={`/owners/${team.owner.id}`} className="hover:text-primary hover:underline">{ownerName(team.owner)}</Link>
            ) : (
              "—"
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Season {team.season_year} · <span>{teamRecord(team)}</span>{team.league_finish != null ? ` · Finished ${ordinal(team.league_finish)}` : ""}
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatChip>{team.points_for.toLocaleString("en-US")} PF</StatChip>
        <StatChip>{team.points_against.toLocaleString("en-US")} PA</StatChip>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Weekly scores</h2>
      {team.weekly_scores.length === 0 ? (
        <p className="text-muted-foreground">No weekly scores yet.</p>
      ) : (
        <div className="space-y-4">
          <WeeklyBarChart scores={team.weekly_scores} />
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Week</th>
                  <th className="px-4 py-2 font-medium">Points</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {team.weekly_scores.map((w) => (
                  <tr key={w.week} className="border-t">
                    <td className="px-4 py-2 tabular-nums">{w.week}</td>
                    <td className="px-4 py-2 tabular-nums">{w.points.toLocaleString("en-US")}</td>
                    <td className="px-4 py-2">
                      {w.is_final ? (
                        <span className="text-muted-foreground">Final</span>
                      ) : (
                        <Badge className="bg-highlight text-highlight-foreground">Live</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
