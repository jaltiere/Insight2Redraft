import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { AccountsListPage } from "./AccountsListPage";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

test("lists accounts with roles and grant counts", async () => {
  renderWithAuth(<AccountsListPage />);
  expect(await screen.findByRole("link", { name: /maria@ex.com/ })).toHaveAttribute(
    "href", "/admin/accounts/2",
  );
  expect(screen.getByText("Super-admin")).toBeInTheDocument();
  expect(screen.getAllByText("League-admin")).toHaveLength(2);
  expect(screen.getByText("1 league")).toBeInTheDocument();   // maria
  expect(screen.getByText("0 leagues")).toBeInTheDocument();  // sam
  expect(screen.getByText("—")).toBeInTheDocument();          // super-admin: grants N/A
});

test("Create stays disabled until email and matching 12-char passwords are entered", async () => {
  renderWithAuth(<AccountsListPage />);
  await userEvent.click(await screen.findByRole("button", { name: /new account/i }));

  const create = screen.getByRole("button", { name: /^create$/i });
  expect(create).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/email/i), "new@ex.com");
  await userEvent.type(screen.getByLabelText(/^password$/i), "short");
  await userEvent.type(screen.getByLabelText(/confirm/i), "short");
  expect(create).toBeDisabled();
  expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText(/^password$/i));
  await userEvent.clear(screen.getByLabelText(/confirm/i));
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw124");
  expect(create).toBeDisabled();
  expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText(/confirm/i));
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  expect(create).toBeEnabled();
});

test("a duplicate email surfaces the 409 inline", async () => {
  renderWithAuth(<AccountsListPage />);
  await userEvent.click(await screen.findByRole("button", { name: /new account/i }));
  await userEvent.type(screen.getByLabelText(/email/i), "dupe@ex.com");
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

  expect(await screen.findByText(/account email already exists/i)).toBeInTheDocument();
});
