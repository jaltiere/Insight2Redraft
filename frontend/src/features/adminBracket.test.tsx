import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useAdminBracket } from "./adminBracket";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test("useAdminBracket returns a pending bracket with resolved teams", async () => {
  const { result } = renderHook(() => useAdminBracket(1), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.status).toBe("pending");
  expect(result.current.data?.seeds[0].league_name).toBe("Dynasty League");
  const played = result.current.data?.matchups.find((m) => !m.bye);
  expect(played?.team_a?.owner?.first_name).toBe("Maria");
});

test("useAdminBracket surfaces a 404 as an error the page can branch on", async () => {
  const { result } = renderHook(() => useAdminBracket(99), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
});

test("useAdminBracket stays idle for a null season", () => {
  const { result } = renderHook(() => useAdminBracket(null), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
});
