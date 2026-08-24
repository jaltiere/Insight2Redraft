import { useParams } from "react-router-dom";
import { useOwnerProfile } from "@/features/useOwnerProfile";
import { ordinal, ownerName, teamRecord } from "@/features/standings";
import { NotFound } from "@/pages/NotFound";
import { isApiError } from "@/lib/api-client";

export function OwnerProfilePage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const q = useOwnerProfile(valid ? id : null);

  if (!valid) return <NotFound title="Owner not found" message="We couldn't find that owner." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="Owner not found" message="We couldn't find that owner." />;
    }
    return <p className="text-destructive">Couldn't load this owner.</p>;
  }

  const owner = q.data;

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        {owner.avatar_url ? (
          <img src={owner.avatar_url} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {ownerName(owner).slice(0, 1)}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{ownerName(owner)}</h1>
      </div>

      <h2 className="mb-2 text-lg font-semibold">Season records</h2>
      {owner.season_records.length === 0 ? (
        <p className="text-muted-foreground">No season records yet.</p>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium">League</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Points for</th>
                <th className="px-4 py-2 font-medium">Finish</th>
              </tr>
            </thead>
            <tbody>
              {owner.season_records.map((r) => (
                <tr key={`${r.season_year}-${r.league_id}`} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{r.season_year}</td>
                  <td className="px-4 py-2">{r.league_name}</td>
                  <td className="px-4 py-2 tabular-nums">{teamRecord(r)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.points_for.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.league_finish != null ? ordinal(r.league_finish) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold">Best weekly scores</h2>
      {owner.best_weekly.length === 0 ? (
        <p className="text-muted-foreground">No weekly scores yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owner.best_weekly.map((b, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="font-semibold tabular-nums text-primary">{b.points.toLocaleString("en-US")}</span>
              <span className="text-muted-foreground">{b.season_year} · {b.league_name} · week {b.week}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
