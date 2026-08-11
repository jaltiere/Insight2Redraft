import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test } from "vitest";
import { LeagueDetailPage } from "./LeagueDetailPage";
import { server } from "@/test/server";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/leagues/:id" element={<LeagueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("renders the full standings with owner and team-detail links", async () => {
  renderAt("/leagues/3");
  expect(await screen.findByRole("heading", { name: "Dynasty League" })).toBeInTheDocument();
  expect(await screen.findByText("Jack Altiere")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Jack Altiere" })).toHaveAttribute("href", "/owners/301");
  expect(screen.getByRole("link", { name: /view team detail for Jack Altiere/i })).toHaveAttribute("href", "/teams/31");
});

test("shows not-found on a 404", async () => {
  server.use(http.get("/api/leagues/:id", () => HttpResponse.json({ detail: "League not found" }, { status: 404 })));
  renderAt("/leagues/999");
  expect(await screen.findByText(/league not found/i)).toBeInTheDocument();
});
