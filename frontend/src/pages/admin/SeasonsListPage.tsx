import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useSeasons } from "@/features/useSeasons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeasonFormDialog } from "./SeasonFormDialog";

export function SeasonsListPage() {
  const { role } = useAuth();
  const q = useSeasons();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Seasons</h1>
        {role === "super_admin" && (
          <SeasonFormDialog trigger={<Button>New season</Button>} />
        )}
      </div>
      {q.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-destructive">Couldn't load seasons.</p>
      ) : q.data.length === 0 ? (
        <p className="text-muted-foreground">No seasons yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((s) => (
            <li key={s.id}>
              <Link
                to={`/admin/seasons/${s.id}`}
                className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm hover:border-primary"
              >
                <span className="font-semibold">{s.year}</span>
                <Badge variant="secondary">{s.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
