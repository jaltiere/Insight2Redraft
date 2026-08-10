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
];
