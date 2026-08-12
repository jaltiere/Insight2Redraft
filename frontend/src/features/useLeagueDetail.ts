import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { LeagueDetail, TeamDetail } from "@/types/api";

export function useLeague(id: number | null) {
  return useQuery({
    queryKey: ["league", id],
    queryFn: () => apiClient.get<LeagueDetail>(`/leagues/${id}`),
    enabled: id !== null,
  });
}

export function useTeam(id: number | null) {
  return useQuery({
    queryKey: ["team", id],
    queryFn: () => apiClient.get<TeamDetail>(`/teams/${id}`),
    enabled: id !== null,
  });
}
