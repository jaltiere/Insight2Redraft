import { useSeasons } from "@/features/useSeasons";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import type { SeasonStatus } from "@/types/api";

const STATUS_LABEL: Record<SeasonStatus, string> = {
  setup: "Setup",
  regular: "Regular season",
  playoffs: "Playoffs",
  complete: "Complete",
};

function StatusBadge({ status }: { status: SeasonStatus }) {
  const variant = status === "playoffs" ? "default" : status === "complete" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export function SeasonsPage() {
  const { data, isPending, isError } = useSeasons();

  return (
    <div>
      <PageHeader title="Seasons" description="Every season across the leagues." />
      {isPending && <p className="text-muted-foreground">Loading seasons…</p>}
      {isError && <p className="text-destructive">Couldn't load seasons.</p>}
      {data && (
        <div className="divide-y rounded-lg border">
          {data.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-lg font-semibold tabular-nums">{s.year}</span>
              <StatusBadge status={s.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
