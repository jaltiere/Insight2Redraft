import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { OwnerCombobox } from "./OwnerCombobox";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

test("searching and picking an owner calls onSelect with that owner", async () => {
  const onSelect = vi.fn();
  renderWithAuth(<OwnerCombobox onSelect={onSelect} onCancel={() => {}} />);

  await userEvent.type(screen.getByPlaceholderText(/search owners/i), "mar");
  await userEvent.click(await screen.findByRole("button", { name: /Maria Pappas/ }));

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 2, last_name: "Pappas" });
});

test("Cancel calls onCancel", async () => {
  const onCancel = vi.fn();
  renderWithAuth(<OwnerCombobox onSelect={() => {}} onCancel={onCancel} />);
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});
