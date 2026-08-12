import type { WeeklyScoreEntry } from "@/types/api";

export function WeeklyBarChart({ scores }: { scores: WeeklyScoreEntry[] }) {
  const max = Math.max(1, ...scores.map((s) => s.points));
  const first = scores[0]?.week;
  const last = scores[scores.length - 1]?.week;
  const liveWeeks = scores.filter((s) => !s.is_final).map((s) => s.week);
  const liveNote =
    liveWeeks.length > 0
      ? `. Live (not final): week${liveWeeks.length > 1 ? "s" : ""} ${liveWeeks.join(", ")}`
      : "";

  return (
    <div
      role="img"
      aria-label={`Weekly points, weeks ${first} to ${last}${liveNote}`}
      className="flex items-end gap-2 overflow-x-auto rounded-xl border bg-card p-4 shadow-sm"
    >
      {scores.map((s) => {
        const heightPct = Math.max(4, (s.points / max) * 100);
        return (
          <div key={s.week} className="flex min-w-8 flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">{Math.round(s.points)}</span>
            <div className="flex h-40 w-full items-end">
              <div
                className={`w-full rounded-t ${s.is_final ? "bg-chart-1" : "bg-highlight"}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">W{s.week}</span>
          </div>
        );
      })}
    </div>
  );
}
