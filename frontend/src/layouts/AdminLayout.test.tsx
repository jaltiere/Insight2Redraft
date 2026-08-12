import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderShell() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<div>home content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
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
