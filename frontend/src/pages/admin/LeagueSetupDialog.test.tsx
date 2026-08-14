import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
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
