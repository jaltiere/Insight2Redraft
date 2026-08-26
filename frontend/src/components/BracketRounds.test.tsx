import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { BracketRounds } from "./BracketRounds";
import { groupByRound } from "@/features/bracket";
import type { BracketMatchupAdmin, BracketTeamRef } from "@/types/api";

const maria: BracketTeamRef = {
  team_id: 31, seed: 1, league_name: "Dynasty League",
  owner: { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null },
};
const jack: BracketTeamRef = {
  team_id: 32, seed: 4, league_name: "Redraft Kings",
  owner: { id: 1, first_name: "Jack", last_name: "Altiere", display_name: "JackA", avatar_url: null },
};

function matchup(over: Partial<BracketMatchupAdmin> = {}): BracketMatchupAdmin {
  return {
    id: 1, round: 1, nfl_week: 15, team_a: maria, team_b: jack,
    team_a_score: null, team_b_score: null, winner_team_id: null,
    is_finalized: false, bye: false, ...over,
  };
}

test("groupByRound groups and orders rounds, carrying each round's week", () => {
  const rounds = groupByRound([
    matchup({ id: 3, round: 2, nfl_week: 16 }),
    matchup({ id: 1, round: 1, nfl_week: 15 }),
    matchup({ id: 2, round: 1, nfl_week: 15 }),
  ]);
  expect(rounds.map((r) => r.round)).toEqual([1, 2]);
  expect(rounds[0].matchups).toHaveLength(2);
  expect(rounds[1].nfl_week).toBe(16);
});

test("renders each round with its week, and both teams with seeds", () => {
  render(<BracketRounds rounds={groupByRound([matchup()])} />);
  expect(screen.getByText(/round 1/i)).toBeInTheDocument();
  expect(screen.getByText(/week 15/i)).toBeInTheDocument();
  expect(screen.getByText(/Maria Pappas/)).toBeInTheDocument();
  expect(screen.getByText(/JackA/)).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
});

test("a bye shows the advancing team and no opponent", () => {
  render(<BracketRounds rounds={groupByRound([matchup({ team_b: null, bye: true })])} />);
  expect(screen.getByText(/Maria Pappas/)).toBeInTheDocument();
  expect(screen.getByText(/bye/i)).toBeInTheDocument();
});

test("a finalized matchup shows scores and marks the winner", () => {
  render(
    <BracketRounds
      rounds={groupByRound([
        matchup({ team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31, is_finalized: true }),
      ])}
    />,
  );
  expect(screen.getByText("122.5")).toBeInTheDocument();
  expect(screen.getByText("98.25")).toBeInTheDocument();
  const winner = screen.getByTestId("team-31");
  expect(within(winner).getByLabelText(/winner/i)).toBeInTheDocument();
});

test("an unplayed matchup shows no scores", () => {
  render(<BracketRounds rounds={groupByRound([matchup()])} />);
  expect(screen.queryByTestId("score-31")).toBeNull();
});
