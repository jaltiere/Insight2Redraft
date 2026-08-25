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

/**
 * Rounds a single-elimination bracket needs to reach a champion, given its
 * field size. The backend pads a non-power-of-two field with byes (e.g. size
 * 6 pads to 8), so this is `ceil(log2(size))`, not derived from whatever
 * rounds happen to already exist — `generate_bracket` only ever creates round
 * 1 up front; later rounds appear as earlier ones finalize. Sizes of 0 or 1
 * need no rounds.
 */
export function roundsForSize(size: number): number {
  if (size <= 1) return 0;
  return Math.ceil(Math.log2(size));
}
