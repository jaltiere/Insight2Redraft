import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useSeason } from "@/features/useSeasonDashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFound } from "@/pages/NotFound";
import { SeasonFormDialog } from "./SeasonFormDialog";
import { isApiError } from "@/lib/api-client";

export function SeasonDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && !Number.isNaN(id);
  const { role } = useAuth();
  const q = useSeason(valid ? id : null);

  if (!valid) return <NotFound title="Season not found" message="We couldn't find that season." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Season not found" message="We couldn't find that season." />;
    }
    return <p className="text-destructive">Couldn't load this season.</p>;
  }

  const season = q.data;
  const isSuper = role === "super_admin";

  return (
    <div>
      <div className="mb-1"><Link to="/admin/seasons" className="text-sm text-primary hover:underline">← Seasons</Link></div>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Season {season.year}</h1>
        <Badge variant="secondary">{season.status}</Badge>
        {isSuper && (
          <span className="ml-auto">
            <SeasonFormDialog season={season} trigger={<Button variant="outline">Edit</Button>} />
          </span>
        )}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {season.playoff_field_per_league} playoff / league
        {season.nfl_playoff_weeks.length > 0 && <> · weeks {season.nfl_playoff_weeks.join(", ")}</>}
      </p>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Leagues ({season.leagues.length})</h2>
        {/* Task 4 adds the Add-league button here */}
      </div>
      {season.leagues.length === 0 ? (
        <p className="text-muted-foreground">No leagues yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">League</th>
                <th className="px-4 py-2 font-medium">Scoring</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {season.leagues.map((lg) => (
                <tr key={lg.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{lg.name}</td>
                  <td className="px-4 py-2">
                    {lg.scoring_validated
                      ? <Badge variant="secondary">✓ valid</Badge>
                      : <Badge variant="outline">⚠ unverified</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">{/* Task 4/5 add row actions */}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
