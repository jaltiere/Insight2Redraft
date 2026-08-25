import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonDetailPage } from "./SeasonDetailPage";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/1", role = "super_admin") {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id" element={<SeasonDetailPage />} /></Routes>,
    { route: path },
  );
}

test("renders the season header and its leagues", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /season 2024/i })).toBeInTheDocument();
  expect(screen.getByText("Dynasty League")).toBeInTheDocument();
  expect(screen.getByText("Redraft Kings")).toBeInTheDocument();
});

test("Edit is shown for super-admin, hidden for league-admin", async () => {
  renderAt("/admin/seasons/1", "super_admin");
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
});

test("league-admin does not see Edit", async () => {
  renderAt("/admin/seasons/1", "league_admin");
  await screen.findByRole("heading", { name: /season 2024/i });
  expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
});
