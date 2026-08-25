import { screen } from "@testing-library/react";
import { renderWithAuth } from "@/test/renderWithAuth";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { OwnersListPage } from "./OwnersListPage";

afterEach(() => localStorage.clear());

function renderPage() {
  return renderWithAuth(<OwnersListPage />);
}

test("lists owners and links to detail", async () => {
  renderPage();
  expect(await screen.findByRole("link", { name: /Jack Altiere|JackA/ })).toHaveAttribute("href", "/admin/owners/1");
});

test("New owner create shows the 409 inline", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /new owner/i }));
  await userEvent.type(screen.getByLabelText(/first name/i), "Dupe");
  await userEvent.type(screen.getByLabelText(/last name/i), "Person");
  await userEvent.type(screen.getByLabelText(/email/i), "dupe@ex.com");
  await userEvent.click(screen.getByRole("button", { name: /create/i }));
  expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
});
