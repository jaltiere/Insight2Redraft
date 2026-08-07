import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/seasons", () =>
    HttpResponse.json([
      { id: 1, year: 2024, status: "regular" },
      { id: 2, year: 2023, status: "complete" },
    ]),
  ),
];
