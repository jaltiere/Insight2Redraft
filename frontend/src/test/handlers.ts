import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/seasons", () =>
    HttpResponse.json([
      { id: 1, year: 2024, status: "regular" },
      { id: 2, year: 2023, status: "complete" },
    ]),
  ),
  http.post("/api/auth/login", async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    if (email === "admin@example.com" && password === "pw") {
      return HttpResponse.json({ access_token: "tok.123", token_type: "bearer" });
    }
    return HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 });
  }),
  http.get("/api/auth/me", ({ request }) => {
    if (request.headers.get("authorization") === "Bearer tok.123") {
      return HttpResponse.json({ id: 1, email: "admin@example.com", role: "super_admin", owner_id: null });
    }
    return HttpResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }),
  http.get("/api/seasons/:id", ({ params }) =>
    HttpResponse.json({
      id: Number(params.id),
      year: 2024,
      status: "playoffs",
      playoff_field_per_league: 2,
      nfl_playoff_weeks: [15, 16, 17],
      leagues: [
        { id: 3, name: "Dynasty League", scoring_validated: true },
        { id: 4, name: "Redraft Kings", scoring_validated: true },
      ],
    }),
  ),
  http.get("/api/leagues/:id", ({ params }) => {
    const id = Number(params.id);
    return HttpResponse.json({
      id,
      name: id === 3 ? "Dynasty League" : "Redraft Kings",
      season_id: 1,
      season_year: 2024,
      scoring_validated: true,
      standings: [
        {
          team_id: id * 10 + 1,
          owner: { id: id * 100 + 1, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
          wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: null,
        },
        {
          team_id: id * 10 + 2,
          owner: { id: id * 100 + 2, first_name: "Maria", last_name: "Pappas", display_name: null, avatar_url: null },
          wins: 9, losses: 4, ties: 0, points_for: 1500, points_against: 1420, league_finish: null,
        },
      ],
    });
  }),
  http.get("/api/teams/:id", ({ params }) => {
    const id = Number(params.id);
    return HttpResponse.json({
      id,
      league_id: 3,
      league_name: "Dynasty League",
      season_year: 2024,
      owner: { id: 301, first_name: "Jack", last_name: "Altiere", display_name: null, avatar_url: null },
      wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: 1,
      weekly_scores: [
        { week: 1, points: 120.5, is_final: true },
        { week: 2, points: 98.0, is_final: true },
        { week: 3, points: 110.2, is_final: false },
      ],
    });
  }),
  // --- admin: seasons & leagues (FE-3b) ---
  http.post("/api/admin/seasons", async ({ request }) => {
    const body = (await request.json()) as { year: number };
    if (body.year === 2024) {
      return HttpResponse.json({ detail: "Season year already exists" }, { status: 409 });
    }
    return HttpResponse.json(
      { id: 99, year: body.year, status: "setup", scoring_ruleset_id: null, playoff_field_per_league: 2, nfl_playoff_weeks: [] },
      { status: 201 },
    );
  }),
  http.patch("/api/admin/seasons/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: Number(params.id), year: 2024, status: "regular", scoring_ruleset_id: null,
      playoff_field_per_league: 2, nfl_playoff_weeks: [15, 16, 17], ...body,
    });
  }),
  http.post("/api/admin/seasons/:id/leagues", async ({ request }) => {
    const body = (await request.json()) as { sleeper_league_id: string };
    if (body.sleeper_league_id === "notfound") {
      return HttpResponse.json({ detail: "Sleeper league not found" }, { status: 422 });
    }
    const differs = body.sleeper_league_id === "diffs";
    return HttpResponse.json(
      {
        league_id: 5, name: "New League", scoring_validated: !differs,
        diffs: differs ? [{ category: "Pass TD", league_value: 6, platform_value: 4 }] : [],
        teams: [{ team_id: 51, sleeper_roster_id: 1, sleeper_user_id: "u1" }],
      },
      { status: 201 },
    );
  }),
  http.post("/api/admin/leagues/:id/resync-setup", ({ params }) =>
    HttpResponse.json({
      league_id: Number(params.id), name: "Dynasty League", scoring_validated: true, diffs: [],
      teams: [{ team_id: 31, sleeper_roster_id: 1, sleeper_user_id: "u1" }],
    }),
  ),
  http.post("/api/admin/leagues/:id/sync", ({ params }) =>
    HttpResponse.json({ league_id: Number(params.id), week: 14, teams_synced: 12, rosters_skipped: 0, mismatches: 0 }),
  ),
  http.delete("/api/admin/leagues/:id", () => new HttpResponse(null, { status: 204 })),
];
