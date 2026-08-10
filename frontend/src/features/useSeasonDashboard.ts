import { useQueries, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { LeagueDetail, SeasonDetail } from "@/types/api";

export function useSeason(seasonId: number | null) {
  return useQuery({
    queryKey: ["season", seasonId],
    queryFn: () => apiClient.get<SeasonDetail>(`/seasons/${seasonId}`),
    enabled: seasonId !== null,
  });
}

export function useLeagues(leagueIds: number[]) {
  return useQueries({
    queries: leagueIds.map((id) => ({
      queryKey: ["league", id],
      queryFn: () => apiClient.get<LeagueDetail>(`/leagues/${id}`),
    })),
  });
}
