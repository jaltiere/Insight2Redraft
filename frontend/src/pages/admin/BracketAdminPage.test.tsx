import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path: string) {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

test("a pending bracket renders its seeds and rounds", async () => {
  renderAt("/admin/seasons/1/bracket");
  expect(await screen.findByText(/round 1/i)).toBeInTheDocument();
  // "Maria Pappas" appears both in the seed table and in the round matchup —
  // assert at least one match rather than a single unique one.
  expect(screen.getAllByText(/Maria Pappas/).length).toBeGreaterThan(0);
  expect(screen.getByText("pending")).toBeInTheDocument();
});

test("the seed table renders seed rows with league and qualification", async () => {
  renderAt("/admin/seasons/1/bracket");
  await screen.findByText(/round 1/i);
  expect(screen.getAllByText("Dynasty League").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Redraft Kings").length).toBeGreaterThan(0);
  expect(screen.getByText("auto")).toBeInTheDocument();
  expect(screen.getByText("wildcard")).toBeInTheDocument();
});

test("no bracket in a playoffs season offers Generate", async () => {
  // season 99 has no bracket; make that season report playoffs status
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  expect(await screen.findByText(/no bracket yet/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /generate bracket/i })).toBeEnabled();
});

test("Generate is disabled when the season is not in playoffs", async () => {
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "regular",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  expect(await screen.findByRole("button", { name: /generate bracket/i })).toBeDisabled();
  expect(screen.getByText(/must be in playoffs/i)).toBeInTheDocument();
});

test("generating asks for confirmation first", async () => {
  server.use(
    http.get("/api/seasons/99", () =>
      HttpResponse.json({
        id: 99, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], leagues: [],
      }),
    ),
  );
  renderAt("/admin/seasons/99/bracket");
  await userEvent.click(await screen.findByRole("button", { name: /generate bracket/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^generate$/i })).toBeInTheDocument();
});

test("an active bracket shows scores and no generate action", async () => {
  renderAt("/admin/seasons/7/bracket");
  expect(await screen.findByText("active")).toBeInTheDocument();
  expect(screen.getByText("122.5")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /generate bracket/i })).toBeNull();
});

test("a non-numeric season id renders not-found", async () => {
  renderAt("/admin/seasons/abc/bracket");
  expect(await screen.findByText(/bracket not found|season not found/i)).toBeInTheDocument();
});
