import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueStandingsCard } from "./LeagueStandingsCard";
import type { LeagueDetail } from "@/types/api";

const league: LeagueDetail = {
  id: 3,
  name: "Dynasty League",
  season_id: 1,
  season_year: 2024,
  scoring_validated: true,
  standings: [
    {
      team_id: 10,
      owner: { id: 100, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
      wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: null,
    },
    {
      team_id: 11,
      owner: null,
      wins: 5, losses: 8, ties: 0, points_for: 1200, points_against: 1450, league_finish: null,
    },
  ],
};

function renderCard() {
  return render(
    <MemoryRouter>
      <LeagueStandingsCard league={league} />
    </MemoryRouter>,
  );
}

test("renders league name, owner link, record, and the view-league link", () => {
  renderCard();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jack Altiere" })).toHaveAttribute("href", "/owners/100");
  expect(screen.getByText("11-2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view league/i })).toHaveAttribute("href", "/leagues/3");
});

test("renders a null owner as a dash without crashing", () => {
  renderCard();
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});
