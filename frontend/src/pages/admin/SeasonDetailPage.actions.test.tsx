import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonDetailPage } from "./SeasonDetailPage";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(role = "super_admin") {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  return renderWithAuth(
    <Routes><Route path="/admin/seasons/:id" element={<SeasonDetailPage />} /></Routes>,
    { route: "/admin/seasons/1" },
  );
}

test("Sync now shows a result note (season is in playoffs)", async () => {
  renderAt("super_admin");
  const syncButtons = await screen.findAllByRole("button", { name: /sync now/i });
  await userEvent.click(syncButtons[0]);
  expect(await screen.findByText(/12 synced/i)).toBeInTheDocument();
});

test("league-admin sees Sync now but not Resync/Delete", async () => {
  renderAt("league_admin");
  expect((await screen.findAllByRole("button", { name: /sync now/i })).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /resync/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
});

test("Delete confirms then removes the league", async () => {
  renderAt("super_admin");
  const del = (await screen.findAllByRole("button", { name: /^delete$/i }))[0];
  await userEvent.click(del);
  await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
  // after 204 + invalidate, the confirm dialog closes
  expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
});

test("Delete failure keeps the dialog open and shows the error", async () => {
  server.use(
    http.delete("/api/admin/leagues/:id", () =>
      HttpResponse.json({ detail: "League is in use" }, { status: 409 })),
  );
  renderAt("super_admin");
  const del = (await screen.findAllByRole("button", { name: /^delete$/i }))[0];
  await userEvent.click(del);
  await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
  expect(await screen.findByText(/in use/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
});
