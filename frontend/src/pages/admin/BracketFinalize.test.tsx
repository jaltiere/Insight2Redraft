import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { BracketAdminPage } from "./BracketAdminPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/7/bracket") {
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id/bracket" element={<BracketAdminPage />} /></Routes>,
    { route: path },
  );
}

test("an active bracket offers Finalize round naming the round and week", async () => {
  renderAt();
  const button = await screen.findByRole("button", { name: /finalize round/i });
  expect(button).toBeInTheDocument();
  await userEvent.click(button);

  // "Round 1 · week 15" also appears in the page's own round heading, so scope
  // these assertions to the dialog or they match two nodes and RTL throws.
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByText(/round 1/i)).toBeInTheDocument();
  expect(dialog.getByText(/week 15/i)).toBeInTheDocument();
  expect(dialog.getByText(/can't be undone|cannot be undone/i)).toBeInTheDocument();
});

test("a finalize refusal surfaces the server message inline", async () => {
  // season 7's finalize handler returns 409 "Scores are not synced for week 15"
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /finalize round/i }));
  await userEvent.click(screen.getByRole("button", { name: /^finalize$/i }));
  expect(await screen.findByText(/scores are not synced/i)).toBeInTheDocument();
});

test("a pending bracket offers no finalize action", async () => {
  renderAt("/admin/seasons/1/bracket");
  await screen.findByText("pending");
  expect(screen.queryByRole("button", { name: /finalize round/i })).toBeNull();
});

test("a complete bracket marks the champion and offers no actions", async () => {
  server.use(
    http.get("/api/admin/seasons/7/bracket", () =>
      HttpResponse.json({
        id: 6, season_id: 7, size: 2, status: "complete",
        seeds: [],
        matchups: [
          {
            id: 91, round: 1, nfl_week: 15,
            team_a: { team_id: 31, seed: 1, league_name: "Dynasty League", owner: { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null } },
            team_b: { team_id: 32, seed: 2, league_name: "Redraft Kings", owner: null },
            team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31,
            is_finalized: true, bye: false,
          },
        ],
      }),
    ),
  );
  renderAt();
  await screen.findByText("complete");
  expect(screen.getByLabelText(/champion/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /finalize round/i })).toBeNull();
});

test("a finalize success on season 6 closes the dialog with no error, and the request actually fired", async () => {
  // season 6's GET returns an active bracket with round 1 unfinalized (fixture
  // `active6`); its finalize-round handler succeeds (fixture `activeFinalized`),
  // returning round 1 finalized (winner_team_id: 31) plus a round-2 matchup
  // (id: 92, round 2, week 16, team_a the round-1 winner, team_b null). Wrap the
  // handler to count invocations so the assertion can't pass merely because the
  // button was inert — it requires the mutation to have actually gone out over
  // the network and resolved successfully.
  let finalizeCalls = 0;
  server.use(
    // Scoped to season 6's concrete path (not the :id wildcard) so a request
    // for the wrong season would fall through unhandled rather than silently
    // incrementing the counter.
    http.post("/api/admin/seasons/6/bracket/finalize-round", () => {
      finalizeCalls += 1;
      const maria = { id: 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null };
      const refA = { team_id: 31, seed: 1, league_name: "Dynasty League", owner: maria };
      const refB = { team_id: 32, seed: 2, league_name: "Redraft Kings", owner: null };
      return HttpResponse.json({
        id: 7, season_id: 6, size: 2, status: "active",
        seeds: [
          { seed: 1, team_id: 31, qualified_via: "auto", league_name: "Dynasty League", owner: maria },
          { seed: 2, team_id: 32, qualified_via: "wildcard", league_name: "Redraft Kings", owner: null },
        ],
        matchups: [
          {
            id: 91, round: 1, nfl_week: 15, team_a: refA, team_b: refB,
            team_a_score: 122.5, team_b_score: 98.25, winner_team_id: 31,
            is_finalized: true, bye: false,
          },
          {
            id: 92, round: 2, nfl_week: 16, team_a: refA, team_b: null,
            team_a_score: null, team_b_score: null, winner_team_id: null,
            is_finalized: false, bye: false,
          },
        ],
      });
    }),
  );

  renderAt("/admin/seasons/6/bracket");
  await userEvent.click(await screen.findByRole("button", { name: /finalize round/i }));
  await userEvent.click(screen.getByRole("button", { name: /^finalize$/i }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(finalizeCalls).toBe(1);
  expect(screen.queryByRole("alert")).toBeNull();
});
