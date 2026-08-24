import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { OwnerDetailPage } from "./OwnerDetailPage";
import { AuthProvider } from "@/auth/AuthProvider";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(role = "super_admin") {
  localStorage.setItem("i2r_token", "tok.123");
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/owners/1"]}>
        <AuthProvider><Routes><Route path="/admin/owners/:id" element={<OwnerDetailPage />} /></Routes></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders owner header + sleeper links", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: /Jack Altiere|JackA/ })).toBeInTheDocument();
  expect(screen.getByText(/jaltiere/)).toBeInTheDocument();
});

test("Edit is super-admin only", async () => {
  renderAt("league_admin");
  await screen.findByRole("heading", { name: /Jack Altiere|JackA/ });
  expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
});
