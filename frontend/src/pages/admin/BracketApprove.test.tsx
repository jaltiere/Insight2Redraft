import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/1/bracket") {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

/** Season 1 with a given number of playoff weeks. */
function seasonWithWeeks(weeks: number[]) {
  server.use(
    http.get("/api/seasons/1", () =>
      HttpResponse.json({
        id: 1, year: 2024, status: "playoffs",
        playoff_field_per_league: 2, nfl_playoff_weeks: weeks, leagues: [],
      }),
    ),
  );
}

test("a pending bracket offers Approve and Regenerate", async () => {
  seasonWithWeeks([15, 16, 17]);
  renderAt();
  expect(await screen.findByRole("button", { name: /approve bracket/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
});

test("approving warns that it cannot be undone", async () => {
  seasonWithWeeks([15, 16, 17]);
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(await screen.findByText(/can't be undone|cannot be undone/i)).toBeInTheDocument();
});

test("no warning when the season has enough playoff weeks", async () => {
  seasonWithWeeks([15]); // 1 week, bracket has 1 round → rounds do NOT exceed weeks
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(screen.queryByText(/more rounds than/i)).toBeNull();
});

test("warns when rounds exceed available weeks", async () => {
  seasonWithWeeks([]); // 0 weeks, bracket has 1 round → warning
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /approve bracket/i }));
  expect(await screen.findByText(/more rounds than/i)).toBeInTheDocument();
  // advisory only — approval is still possible
  expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
});

test("an active bracket offers neither Approve nor Regenerate", async () => {
  renderAt("/admin/seasons/7/bracket");
  await screen.findByText("active");
  expect(screen.queryByRole("button", { name: /approve bracket/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
});
