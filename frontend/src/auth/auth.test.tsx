import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "./useAuth";
import { LoginPage } from "@/pages/LoginPage";

afterEach(() => localStorage.clear());

function wrap(ui: ReactNode, initial = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function Protected() {
  return (
    <Routes>
      <Route path="/login" element={<div>Login screen</div>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Secret</div>} />
      </Route>
    </Routes>
  );
}

test("protected route redirects to /login when unauthenticated", async () => {
  wrap(<Protected />, "/");
  expect(await screen.findByText("Login screen")).toBeInTheDocument();
});

test("login stores the token and authenticates", async () => {
  function Probe() {
    const { isAuthenticated, login } = useAuth();
    return (
      <div>
        <span>{isAuthenticated ? "in" : "out"}</span>
        <button onClick={() => login("admin@example.com", "pw")}>go</button>
      </div>
    );
  }
  wrap(<Probe />);
  await screen.findByText("out");
  await userEvent.click(screen.getByRole("button", { name: "go" }));
  await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
  expect(localStorage.getItem("i2r_token")).toBe("tok.123");
});

test("login page shows an error on bad credentials", async () => {
  wrap(<LoginPage />, "/login");
  await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
  await userEvent.type(screen.getByLabelText(/password/i), "wrong");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
});
