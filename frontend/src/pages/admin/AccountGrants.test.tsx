import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AccountDetailPage } from "./AccountDetailPage";
import { renderWithAuth } from "@/test/renderWithAuth";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/accounts/2") {
  return renderWithAuth(
    <Routes><Route path="/admin/accounts/:id" element={<AccountDetailPage />} /></Routes>,
    { route: path },
  );
}

test("lists the account's granted leagues with a revoke action", async () => {
  renderAt();
  const grants = await screen.findByRole("list", { name: /granted leagues/i });
  expect(within(grants).getByText("Dynasty League")).toBeInTheDocument();
  expect(within(grants).getByRole("button", { name: /revoke/i })).toBeInTheDocument();
});

test("an account with no grants says so", async () => {
  renderAt("/admin/accounts/3");
  expect(await screen.findByText(/no leagues granted yet/i)).toBeInTheDocument();
});

test("the grant dialog disables leagues the account already holds", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /grant league/i }));
  expect(await screen.findByRole("button", { name: /Redraft Kings/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /Dynasty League/ })).toBeDisabled();
});

test("granting a league closes the dialog", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /grant league/i }));
  await userEvent.click(await screen.findByRole("button", { name: /Redraft Kings/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a super-admin account shows no grants block", async () => {
  renderAt("/admin/accounts/1");
  await screen.findByRole("heading", { name: "admin@example.com" });
  expect(screen.queryByRole("button", { name: /grant league/i })).toBeNull();
  expect(screen.getByText(/grants apply only to league-admin accounts/i)).toBeInTheDocument();
});
