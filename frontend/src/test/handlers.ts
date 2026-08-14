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
  // --- admin: owners (FE-3c) ---
  http.get("/api/admin/owners", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const all = [
      { id: 1, first_name: "Jack", last_name: "Altiere", email: "jack@ex.com", display_name: "JackA", avatar_url: null, notes: "commish" },
      { id: 2, first_name: "Maria", last_name: "Pappas", email: "maria@ex.com", display_name: null, avatar_url: null, notes: null },
    ];
    const rows = q ? all.filter((o) => `${o.first_name} ${o.last_name} ${o.email ?? ""}`.toLowerCase().includes(q)) : all;
    return HttpResponse.json(rows);
  }),
  http.post("/api/admin/owners", async ({ request }) => {
    const b = (await request.json()) as { email?: string | null };
    if (b.email === "dupe@ex.com") return HttpResponse.json({ detail: "Owner email already exists" }, { status: 409 });
    return HttpResponse.json({ id: 99, first_name: "New", last_name: "Owner", email: b.email ?? null, display_name: null, avatar_url: null, notes: null }, { status: 201 });
  }),
  http.get("/api/admin/owners/:id", ({ params }) =>
    HttpResponse.json({
      id: Number(params.id), first_name: "Jack", last_name: "Altiere", email: "jack@ex.com",
      display_name: "JackA", avatar_url: null, notes: "commish",
      sleeper_links: [{ sleeper_user_id: "u1", season: 2024, sleeper_display_name: "jaltiere" }],
    }),
  ),
  http.patch("/api/admin/owners/:id", async ({ params, request }) => {
    const b = (await request.json()) as Record<string, unknown>;
    if (b.email === "dupe@ex.com") return HttpResponse.json({ detail: "Owner email already exists" }, { status: 409 });
    return HttpResponse.json({ id: Number(params.id), first_name: "Jack", last_name: "Altiere", email: "jack@ex.com", display_name: "JackA", avatar_url: null, notes: null, ...b });
  }),
  // --- admin: team mapping (FE-3c) ---
  http.get("/api/admin/leagues/:id/teams", () =>
    HttpResponse.json([
      { team_id: 31, sleeper_roster_id: 3, sleeper_user_id: "u1", sleeper_display_name: "jaltiere", owner: { id: 1, first_name: "Jack", last_name: "Altiere", display_name: "JackA" } },
      { team_id: 32, sleeper_roster_id: 5, sleeper_user_id: "u2", sleeper_display_name: "mpappas", owner: null },
    ]),
  ),
  http.patch("/api/admin/leagues/:lid/teams/:tid", async ({ params, request }) => {
    const b = (await request.json()) as { owner_id: number };
    if (b.owner_id === 0) return HttpResponse.json({ detail: "Owner does not exist" }, { status: 422 });
    return HttpResponse.json({ team_id: Number(params.tid), sleeper_roster_id: 5, sleeper_user_id: "u2", sleeper_display_name: "mpappas", owner: { id: b.owner_id, first_name: "Maria", last_name: "Pappas", display_name: null } });
  }),
  // --- public: owner profile (FE-3c) ---
  http.get("/api/owners/:id", ({ params }) => {
    if (params.id === "404") return HttpResponse.json({ detail: "Owner not found" }, { status: 404 });
    return HttpResponse.json({
      id: Number(params.id), first_name: "Jack", last_name: "Altiere", display_name: "JackA", avatar_url: null,
      season_records: [{ season_year: 2024, league_id: 3, league_name: "Dynasty League", wins: 11, losses: 2, ties: 0, points_for: 1612, points_against: 1400, league_finish: 1 }],
      best_weekly: [{ season_year: 2024, league_name: "Dynasty League", week: 5, points: 155.2 }],
    });
  }),
];
