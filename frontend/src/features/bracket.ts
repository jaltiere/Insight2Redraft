import type { BracketMatchupAdmin } from "@/types/api";

export interface BracketRound {
  round: number;
  nfl_week: number;
  matchups: BracketMatchupAdmin[];
}

/**
 * The admin payload is a flat matchup list; the public one arrives pre-grouped.
 * Grouping lives here so both callers agree on shape and ordering.
 */
export function groupByRound(matchups: BracketMatchupAdmin[]): BracketRound[] {
  const byRound = new Map<number, BracketMatchupAdmin[]>();
  for (const m of matchups) {
    const group = byRound.get(m.round);
    if (group) group.push(m);
    else byRound.set(m.round, [m]);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, group]) => ({ round, nfl_week: group[0].nfl_week, matchups: group }));
}

/** Deepest round number present, or 0 for an empty bracket. */
export function roundCount(matchups: BracketMatchupAdmin[]): number {
  return matchups.reduce((max, m) => (m.round > max ? m.round : max), 0);
}
