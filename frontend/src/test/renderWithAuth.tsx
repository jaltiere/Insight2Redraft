import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";

/**
 * Renders `ui` inside the provider stack every admin/auth test needs:
 * QueryClient → MemoryRouter → AuthProvider.
 *
 * Pass `token: null` to render signed-out. The returned `queryClient` lets a
 * test assert on cache behaviour (e.g. that a 401 clears it).
 */
export function renderWithAuth(
  ui: ReactNode,
  { route = "/", token = "tok.123" }: { route?: string; token?: string | null } = {},
) {
  if (token !== null) localStorage.setItem("i2r_token", token);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
