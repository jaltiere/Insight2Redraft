import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import { http, HttpResponse } from "msw";
import { afterEach, expect, test } from "vitest";
import { AdminHome } from "./AdminHome";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderHome() {
  return renderWithAuth(<AdminHome />);
}

test("super-admin hub shows the Accounts card", async () => {
  renderHome();
  expect(await screen.findByRole("link", { name: /Accounts/ })).toHaveAttribute("href", "/admin/accounts");
  expect(screen.getByRole("link", { name: /Seasons/ })).toHaveAttribute("href", "/admin/seasons");
});

test("league-admin hub hides the Accounts card", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderHome();
  expect(await screen.findByRole("link", { name: /Seasons/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Accounts/ })).toBeNull();
});
