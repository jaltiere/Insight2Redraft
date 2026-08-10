import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PointsBar } from "@/components/PointsBar";
import type { LeagueDetail, TeamStanding } from "@/types/api";

const TOP_N = 5;

function ownerName(s: TeamStanding): string {
  if (!s.owner) return "—";
  return s.owner.display_name ?? `${s.owner.first_name} ${s.owner.last_name}`;
}

function record(s: TeamStanding): string {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

export function LeagueStandingsCard({ league }: { league: LeagueDetail }) {
  const rows = league.standings.slice(0, TOP_N);
  const maxPf = Math.max(1, ...league.standings.map((s) => s.points_for));
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
        <h3 className="font-semibold text-primary">{league.name}</h3>
        <Badge variant={league.scoring_validated ? "secondary" : "outline"}>
          {league.scoring_validated ? "Scoring ✓" : "Unverified"}
        </Badge>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Record</th>
            <th className="px-4 py-2 font-medium">Points for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.team_id} className={i === 0 ? "border-t bg-primary/5" : "border-t"}>
              <td className="px-4 py-2">
                {i === 0 ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    1
                  </span>
                ) : (
                  <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                )}
              </td>
              <td className="px-4 py-2 font-medium">
                {s.owner ? (
                  <Link to={`/owners/${s.owner.id}`} className="hover:text-primary hover:underline">
                    {ownerName(s)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 tabular-nums">{record(s)}</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <PointsBar value={s.points_for} max={maxPf} />
                  <span className="tabular-nums text-muted-foreground">
                    {s.points_for.toLocaleString("en-US")}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t px-4 py-2 text-right">
        <Link to={`/leagues/${league.id}`} className="text-sm font-medium text-primary hover:underline">
          View league →
        </Link>
      </div>
    </div>
  );
}
