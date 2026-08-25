import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { LeagueSetupDialog } from "./LeagueSetupDialog";

function renderAdd() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeagueSetupDialog mode="add" seasonId={1} trigger={<button>Add league</button>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("adds a league and shows the validated result", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "abc123");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/added/i)).toBeInTheDocument();
  expect(screen.getByText(/New League/)).toBeInTheDocument();
});

test("shows the scoring diffs when scoring differs", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "diffs");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/scoring differs/i)).toBeInTheDocument();
  expect(screen.getByText("Pass TD")).toBeInTheDocument();
});

test("shows the 422 not-found error", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "notfound");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/sleeper league not found/i)).toBeInTheDocument();
});

test("does not leak result state across dialog re-opens", async () => {
  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "abc123");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  expect(await screen.findByText(/added/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));

  expect(screen.queryByText(/added/i)).toBeNull();
  expect(screen.getByLabelText(/sleeper league id/i)).toHaveValue("");
});

test("a result that lands after the dialog is closed does not leak into the next open", async () => {
  // the add call resolves well after we cancel out of the dialog
  server.use(
    http.post("/api/admin/seasons/:id/leagues", async () => {
      await delay(80);
      return HttpResponse.json(
        { league_id: 7, name: "Late League", scoring_validated: true, diffs: [], teams: [] },
        { status: 201 },
      );
    }),
  );

  renderAdd();
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await userEvent.type(screen.getByLabelText(/sleeper league id/i), "abc123");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

  // reopen before the in-flight request resolves
  await userEvent.click(screen.getByRole("button", { name: "Add league" }));
  await new Promise((r) => setTimeout(r, 150));

  // the stale result must not have populated the freshly-opened dialog
  expect(screen.queryByText(/Late League/)).toBeNull();
  expect(screen.getByLabelText(/sleeper league id/i)).toHaveValue("");
});
