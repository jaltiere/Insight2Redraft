import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { server } from "@/test/server";

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("lands on the latest season and shows its league standings", async () => {
  renderDash();
  expect(await screen.findByText("Season 2024")).toBeInTheDocument();
  expect(await screen.findByText("Dynasty League")).toBeInTheDocument();
  expect(await screen.findByText("Redraft Kings")).toBeInTheDocument();
  expect((await screen.findAllByRole("link", { name: /view league/i })).length).toBe(2);
});

test("the season switcher changes the shown season", async () => {
  renderDash();
  await screen.findByText("Season 2024");
  await userEvent.selectOptions(screen.getByLabelText("Season"), "2023");
  expect(await screen.findByText("Season 2023")).toBeInTheDocument();
});

test("shows an error state when seasons fail to load", async () => {
  server.use(http.get("/api/seasons", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
  renderDash();
  expect(await screen.findByText(/couldn't load seasons/i)).toBeInTheDocument();
});
