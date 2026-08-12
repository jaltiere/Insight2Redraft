import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AdminHome } from "./AdminHome";
import { AdminSectionStub } from "./AdminSectionStub";
import { AuthProvider } from "@/auth/AuthProvider";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AdminLayout } from "@/layouts/AdminLayout";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAdmin(initial: string) {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="owners" element={<AdminSectionStub title="Owners" />} />
              <Route element={<ProtectedRoute requireRole="super_admin" />}>
                <Route path="accounts" element={<AdminSectionStub title="Accounts" />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("super-admin can open the Accounts section", async () => {
  renderAdmin("/admin/accounts");
  expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
});

test("league-admin hitting Accounts sees Not authorized", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: 2, email: "la@i2r", role: "league_admin", owner_id: 5 }),
    ),
  );
  renderAdmin("/admin/accounts");
  expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
});
