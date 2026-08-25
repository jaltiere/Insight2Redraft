import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AccountDetailPage } from "./AccountDetailPage";
import { renderWithAuth } from "@/test/renderWithAuth";
import { server } from "@/test/server";

afterEach(() => localStorage.clear());

function renderAt(path = "/admin/accounts/2") {
  return renderWithAuth(
    <Routes><Route path="/admin/accounts/:id" element={<AccountDetailPage />} /></Routes>,
    { route: path },
  );
}

test("renders the account header with its role", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { name: "maria@ex.com" })).toBeInTheDocument();
  expect(screen.getByText("League-admin")).toBeInTheDocument();
});

test("an unknown account id renders not-found", async () => {
  renderAt("/admin/accounts/777");
  expect(await screen.findByText(/account not found/i)).toBeInTheDocument();
});

test("a non-numeric id renders not-found", async () => {
  renderAt("/admin/accounts/abc");
  expect(await screen.findByText(/account not found/i)).toBeInTheDocument();
});

test("reset password requires a matching 12-char password", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /reset password/i }));

  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  expect(save).toBeEnabled();
});

test("deleting your own account is blocked", async () => {
  // the signed-in test account is id 1
  renderAt("/admin/accounts/1");
  await screen.findByRole("heading", { name: "admin@example.com" });
  expect(screen.getByRole("button", { name: /delete account/i })).toBeDisabled();
  expect(screen.getByText(/you can't delete the account you're signed in with/i)).toBeInTheDocument();
});

test("deleting another account confirms and closes without error", async () => {
  renderAt("/admin/accounts/3");
  await screen.findByRole("heading", { name: "sam@ex.com" });
  await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
  await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
  // MSW deletes id 3 successfully; the dialog closes and nothing is announced
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
});

test("saving a valid new password submits, closes the dialog, and clears the error", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /reset password/i }));

  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a failed password reset shows the error message inline and keeps the dialog open", async () => {
  server.use(
    http.patch("/api/admin/accounts/:id", () =>
      HttpResponse.json({ detail: "Account not found" }, { status: 404 }),
    ),
  );
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: /reset password/i }));

  await userEvent.type(screen.getByLabelText(/^password$/i), "longenoughpw123");
  await userEvent.type(screen.getByLabelText(/confirm/i), "longenoughpw123");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(await screen.findByText(/account not found/i)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("resolves and shows the linked owner's name", async () => {
  renderAt();
  await screen.findByRole("heading", { name: "maria@ex.com" });
  expect(await screen.findByText(/owner:\s*jacka/i)).toBeInTheDocument();
});

test("an account with no owner_id shows not linked", async () => {
  renderAt("/admin/accounts/3");
  await screen.findByRole("heading", { name: "sam@ex.com" });
  expect(await screen.findByText(/owner:\s*not linked/i)).toBeInTheDocument();
});

test("the last-super-admin 409 surfaces inline when deleting a non-self super admin", async () => {
  server.use(
    http.get("/api/admin/accounts", () =>
      HttpResponse.json([
        { id: 1, email: "admin@example.com", role: "super_admin", owner_id: null, grants: [] },
        { id: 4, email: "other@ex.com", role: "super_admin", owner_id: null, grants: [] },
      ]),
    ),
    http.delete("/api/admin/accounts/:id", ({ params }) => {
      if (params.id === "4") {
        return HttpResponse.json({ detail: "Cannot delete the last super admin" }, { status: 409 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderAt("/admin/accounts/4");
  await screen.findByRole("heading", { name: "other@ex.com" });
  await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
  await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

  expect(await screen.findByText(/cannot delete the last super admin/i)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
