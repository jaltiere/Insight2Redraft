import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SeasonDetailPage } from "./SeasonDetailPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/seasons/1", role = "super_admin") {
  localStorage.setItem("i2r_token", "tok.123");
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes><Route path="/admin/seasons/:id" element={<SeasonDetailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
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
