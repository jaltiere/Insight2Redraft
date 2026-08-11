import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueDetailPage } from "./LeagueDetailPage";
import { server } from "@/test/server";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/leagues/:id" element={<LeagueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders the full standings with owner and team-detail links", async () => {
  renderAt("/leagues/3");
  expect(await screen.findByRole("heading", { name: "Dynasty League" })).toBeInTheDocument();
  expect(await screen.findByText("Jack Altiere")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jack Altiere" })).toHaveAttribute("href", "/owners/301");
  expect(screen.getByRole("link", { name: /view team detail for Jack Altiere/i })).toHaveAttribute("href", "/teams/31");
});

test("shows not-found on a 404", async () => {
  server.use(http.get("/api/leagues/:id", () => HttpResponse.json({ detail: "League not found" }, { status: 404 })));
  renderAt("/leagues/999");
  expect(await screen.findByText(/league not found/i)).toBeInTheDocument();
});

test("null-owner row shows an em-dash and no owner link, and a plain team-detail label", async () => {
  server.use(
    http.get("/api/leagues/:id", () =>
      HttpResponse.json({
        id: 3, name: "Dynasty League", season_id: 1, season_year: 2024, scoring_validated: true,
        standings: [
          { team_id: 31, owner: null, wins: 5, losses: 5, ties: 0, points_for: 1000, points_against: 1000, league_finish: null },
        ],
      }),
    ),
  );
  renderAt("/leagues/3");
  expect(await screen.findByRole("heading", { name: "Dynasty League" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View team detail" })).toHaveAttribute("href", "/teams/31");
  expect(screen.queryByRole("link", { name: "—" })).toBeNull();
  // owner cell shows the em-dash
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
});
