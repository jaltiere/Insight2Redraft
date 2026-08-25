import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { useAccounts, useAdminLeagues } from "./adminAccounts";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test("useAccounts returns accounts with their grants", async () => {
  const { result } = renderHook(() => useAccounts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const maria = result.current.data?.find((a) => a.email === "maria@ex.com");
  expect(maria?.role).toBe("league_admin");
  expect(maria?.grants).toEqual([{ league_id: 3, league_name: "Dynasty League" }]);
});

test("useAdminLeagues stays idle until enabled", async () => {
  const { result } = renderHook(() => useAdminLeagues(false), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
});

test("useAdminLeagues loads leagues newest season first when enabled", async () => {
  const { result } = renderHook(() => useAdminLeagues(true), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map((l) => l.name)).toEqual([
    "Dynasty League",
    "Redraft Kings",
    "Keeper Classic",
  ]);
});
