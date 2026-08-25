import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { OwnerDetailPage } from "./OwnerDetailPage";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(role = "super_admin") {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: 1, email: "a@i2r", role, owner_id: null })));
  return renderWithAuth(
    <Routes><Route path="/admin/owners/:id" element={<OwnerDetailPage />} /></Routes>,
    { route: "/admin/owners/1" },
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
