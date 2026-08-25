import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, expect, test } from "vitest";
import { SeasonsListPage } from "./SeasonsListPage";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderPage() {
  return renderWithAuth(<SeasonsListPage />);
}

test("lists seasons and shows New season for super-admin", async () => {
  renderPage();
  expect(await screen.findByRole("link", { name: /2024/ })).toHaveAttribute("href", "/admin/seasons/1");
  expect(screen.getByRole("button", { name: /new season/i })).toBeInTheDocument();
});

test("hides New season for a league-admin", async () => {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 })));
  renderPage();
  await screen.findByRole("link", { name: /2024/ });
  expect(screen.queryByRole("button", { name: /new season/i })).toBeNull();
});

test("creating a duplicate year shows the 409 inline", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /new season/i }));
  await userEvent.clear(screen.getByLabelText(/year/i));
  await userEvent.type(screen.getByLabelText(/year/i), "2024");
  await userEvent.click(screen.getByRole("button", { name: /create/i }));
  expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
});

test("resets the create form across dialog re-opens", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /new season/i }));
  await userEvent.type(screen.getByLabelText(/year/i), "2099");
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

  await userEvent.click(await screen.findByRole("button", { name: /new season/i }));
  expect(screen.getByLabelText(/year/i)).toHaveValue("");
});
