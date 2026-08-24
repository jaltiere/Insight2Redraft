import { useNavigate, useParams } from "react-router-dom";
import { useTeamMappings } from "@/features/adminOwners";
import { OwnerPicker } from "./OwnerPicker";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api-client";

export function MappingPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const navigate = useNavigate();
  const q = useTeamMappings(valid ? id : null);

  if (!valid) return <NotFound title="League not found" message="We couldn't find that league." />;
  if (q.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return <NotFound title="League not found" message="We couldn't find that league." />;
    }
    return <p className="text-destructive">Couldn't load the mapping.</p>;
  }

  const rows = q.data;
  const unassigned = rows.filter((r) => r.owner === null).length;

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Map owners</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {rows.length} teams · {unassigned} unassigned. Changes save per row.
      </p>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Roster</th>
              <th className="px-4 py-2 font-medium">Sleeper user</th>
              <th className="px-4 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team_id} className="border-t align-top">
                <td className="px-4 py-2 tabular-nums">#{r.sleeper_roster_id}</td>
                <td className="px-4 py-2 font-medium">{r.sleeper_display_name ?? r.sleeper_user_id ?? "—"}</td>
                <td className="px-4 py-2">
                  <OwnerPicker
                    leagueId={id}
                    teamId={r.team_id}
                    sleeperName={r.sleeper_display_name}
                    current={r.owner}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
