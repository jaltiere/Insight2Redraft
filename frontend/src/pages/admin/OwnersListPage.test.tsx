import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { OwnersListPage } from "./OwnersListPage";
import { AuthProvider } from "@/auth/AuthProvider";

afterEach(() => localStorage.clear());

function renderPage() {
  localStorage.setItem("i2r_token", "tok.123");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AuthProvider><OwnersListPage /></AuthProvider></MemoryRouter>
    </QueryClientProvider>,
  );
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
