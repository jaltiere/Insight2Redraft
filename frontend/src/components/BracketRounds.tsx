import { ownerName } from "@/features/standings";
import type { BracketRound } from "@/features/bracket";
import type { BracketTeamRef } from "@/types/api";

function TeamLine({
  team, score, isWinner, isChampion,
}: {
  team: BracketTeamRef | null;
  score: number | null;
  isWinner: boolean;
  isChampion: boolean;
}) {
  if (team === null) {
    return <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">—</div>;
  }
  return (
    <div
      data-testid={`team-${team.team_id}`}
      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
        isWinner ? "font-semibold text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-muted-foreground">({team.seed})</span>
        <span>{ownerName(team.owner)}</span>
        <span className="text-muted-foreground">{team.league_name}</span>
        {isWinner && <span aria-label="winner" className="text-highlight">✓</span>}
        {isChampion && <span aria-label="champion" className="text-highlight">🏆</span>}
      </span>
      {score !== null && (
        <span data-testid={`score-${team.team_id}`} className="tabular-nums">
          {score}
        </span>
      )}
    </div>
  );
}

export function BracketRounds({
  rounds, championTeamId = null,
}: {
  rounds: BracketRound[];
  championTeamId?: number | null;
}) {
  if (rounds.length === 0) {
    return <p className="text-muted-foreground">No rounds yet.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {rounds.map((r) => (
        <section key={r.round}>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Round {r.round} · week {r.nfl_week}
          </h2>
          <div className="flex flex-col gap-2">
            {r.matchups.map((m) => (
              <div key={m.id} className="divide-y rounded-xl border bg-card shadow-sm">
                <TeamLine
                  team={m.team_a}
                  score={m.team_a_score}
                  isWinner={m.winner_team_id !== null && m.winner_team_id === m.team_a?.team_id}
                  isChampion={championTeamId !== null && championTeamId === m.team_a?.team_id}
                />
                {m.bye ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">bye</div>
                ) : (
                  <TeamLine
                    team={m.team_b}
                    score={m.team_b_score}
                    isWinner={m.winner_team_id !== null && m.winner_team_id === m.team_b?.team_id}
                    isChampion={championTeamId !== null && championTeamId === m.team_b?.team_id}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
