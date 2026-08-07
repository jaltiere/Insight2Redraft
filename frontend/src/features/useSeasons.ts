import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { SeasonSummary } from "@/types/api";

export function useSeasons() {
  return useQuery({
    queryKey: ["seasons"],
    queryFn: () => apiClient.get<SeasonSummary[]>("/seasons"),
  });
}
