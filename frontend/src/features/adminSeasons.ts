import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  LeagueSetupResponse,
  SeasonAdminResponse,
  SeasonCreateBody,
  SeasonUpdateBody,
  SyncNowResponse,
} from "@/types/api";

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeasonCreateBody) => apiClient.post<SeasonAdminResponse>("/admin/seasons", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seasons"] }),
  });
}

export function useUpdateSeason(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeasonUpdateBody) => apiClient.patch<SeasonAdminResponse>(`/admin/seasons/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["season", id] });
      qc.invalidateQueries({ queryKey: ["seasons"] });
    },
  });
}

export function useAddLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sleeperLeagueId: string) =>
      apiClient.post<LeagueSetupResponse>(`/admin/seasons/${seasonId}/leagues`, {
        sleeper_league_id: sleeperLeagueId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}

export function useResyncLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.post<LeagueSetupResponse>(`/admin/leagues/${leagueId}/resync-setup`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}

export function useSyncLeague() {
  return useMutation({
    mutationFn: (leagueId: number) => apiClient.post<SyncNowResponse>(`/admin/leagues/${leagueId}/sync`),
  });
}

export function useDeleteLeague(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) => apiClient.delete<void>(`/admin/leagues/${leagueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season", seasonId] }),
  });
}
