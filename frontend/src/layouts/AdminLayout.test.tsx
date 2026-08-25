import { screen, within } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { AdminLayout } from "./AdminLayout";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderShell() {
  return renderWithAuth(
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<div>home content</div>} />
        <Route path="seasons" element={<div>seasons content</div>} />
      </Route>
    </Routes>,
    { route: "/admin" },
  );
}

test("super-admin sees all nav sections including Accounts", async () => {
  renderShell();
  expect(await screen.findByRole("link", { name: "Accounts" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Seasons" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Owners" })).toBeInTheDocument();
  expect(screen.getByText("Super-admin")).toBeInTheDocument();
});

test("league-admin does not see the Accounts section", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderShell();
  expect(await screen.findByRole("link", { name: "Seasons" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull();
  expect(screen.getByText("League-admin")).toBeInTheDocument();
});

test("Log out clears the token", async () => {
  renderShell();
  await screen.findByRole("link", { name: "Seasons" });
  await userEvent.click(screen.getByRole("button", { name: /log out/i }));
  expect(localStorage.getItem("i2r_token")).toBeNull();
});

test("the rail collapses to a disclosure menu on narrow screens", async () => {
  renderShell();
  const toggle = await screen.findByRole("button", { name: /open menu/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAttribute("aria-controls", "admin-mobile-nav");
  // closed: only the desktop rail's copy of each link is in the tree
  expect(screen.getAllByRole("link", { name: "Seasons" })).toHaveLength(1);

  await userEvent.click(toggle);
  const opened = screen.getByRole("button", { name: /close menu/i });
  expect(opened).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("link", { name: "Seasons" })).toHaveLength(2);

  // choosing a destination from the mobile menu closes it again
  const mobileNav = document.getElementById("admin-mobile-nav");
  expect(mobileNav).not.toBeNull();
  await userEvent.click(within(mobileNav as HTMLElement).getByRole("link", { name: "Seasons" }));
  expect(await screen.findByText("seasons content")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /open menu/i })).toHaveAttribute("aria-expanded", "false");
});
