import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { TeamDetailPage } from "./TeamDetailPage";
import { server } from "@/test/server";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teams/:id" element={<TeamDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders owner header, league link, record, and the weekly table", async () => {
  renderAt("/teams/31");
  expect(await screen.findByRole("heading", { name: "Jack Altiere" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dynasty League" })).toHaveAttribute("href", "/leagues/3");
  expect(screen.getByText("11-2")).toBeInTheDocument();
  // week rows present (weeks 1,2,3 from the mock)
  expect(screen.getByText("120.5")).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: /weekly points/i })).toBeInTheDocument();
});

test("flags a non-final week as Live", async () => {
  renderAt("/teams/31");
  expect(await screen.findAllByText(/live/i)).not.toHaveLength(0);
});

test("shows empty state when there are no weekly scores", async () => {
  server.use(
    http.get("/api/teams/:id", () =>
      HttpResponse.json({
        id: 31, league_id: 3, league_name: "Dynasty League", season_year: 2024,
        owner: { id: 301, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
        wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, league_finish: null,
        weekly_scores: [],
      }),
    ),
  );
  renderAt("/teams/31");
  expect(await screen.findByText(/no weekly scores yet/i)).toBeInTheDocument();
});

test("shows not-found on a 404", async () => {
  server.use(http.get("/api/teams/:id", () => HttpResponse.json({ detail: "Team not found" }, { status: 404 })));
  renderAt("/teams/999");
  expect(await screen.findByText(/team not found/i)).toBeInTheDocument();
});
