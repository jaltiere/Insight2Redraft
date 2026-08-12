import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminHome } from "./AdminHome";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderHome() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuthProvider>
          <AdminHome />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
