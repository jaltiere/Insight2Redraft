import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { OwnerPicker } from "./OwnerPicker";

function renderPicker(current: null | { id: number; first_name: string; last_name: string; display_name: string | null; avatar_url: string | null } = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OwnerPicker leagueId={9} teamId={32} sleeperName="mpappas" current={current} />
    </QueryClientProvider>,
  );
}

test("unassigned shows a warning and an assign affordance", () => {
  renderPicker(null);
  expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /assign/i })).toBeInTheDocument();
});

test("searching and selecting an owner assigns it", async () => {
  renderPicker(null);
  await userEvent.click(screen.getByRole("button", { name: /assign/i }));
  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  const option = await screen.findByRole("button", { name: /Maria Pappas/ });
  await userEvent.click(option);
  // after assign resolves, the picker collapses back to the resting state
  expect(await screen.findByText(/Maria Pappas|Pappas/)).toBeInTheDocument();
});
