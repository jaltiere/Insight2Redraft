import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "./useAuth";
import { subscribeToken, setToken, clearToken } from "./token";
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

test("subscribeToken notifies on set/clear and stops after unsubscribe", () => {
  const seen: (string | null)[] = [];
  const unsub = subscribeToken((t) => seen.push(t));
  setToken("abc");
  clearToken();
  unsub();
  setToken("def");
  expect(seen).toEqual(["abc", null]);
});

test("a mid-session 401 (token cleared) drops auth and redirects to /login", async () => {
  localStorage.setItem("i2r_token", "tok.123"); // hydrates as super_admin via MSW /auth/me
  function AppRoutes() {
    return (
      <Routes>
        <Route path="/login" element={<div>Login screen</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin" element={<div>Secret admin</div>} />
        </Route>
      </Routes>
    );
  }
  wrap(<AppRoutes />, "/admin");
  expect(await screen.findByText("Secret admin")).toBeInTheDocument();
  act(() => clearToken()); // simulate the api-client clearing the token on a 401
  expect(await screen.findByText("Login screen")).toBeInTheDocument();
});

test("after login the user returns to the originally requested admin route", async () => {
  function AppRoutes() {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/owners" element={<div>Owners stub</div>} />
        </Route>
      </Routes>
    );
  }
  wrap(<AppRoutes />, "/admin/owners"); // unauth → redirected to /login carrying `from`
  await userEvent.type(await screen.findByLabelText(/email/i), "admin@example.com");
  await userEvent.type(screen.getByLabelText(/password/i), "pw");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(await screen.findByText("Owners stub")).toBeInTheDocument();
});
