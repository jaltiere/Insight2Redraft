import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { BracketAdminResponse } from "@/types/api";

export function useAdminBracket(seasonId: number | null) {
  return useQuery({
    queryKey: ["adminBracket", seasonId],
    queryFn: () => apiClient.get<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket`),
    enabled: seasonId !== null,
    retry: false,
  });
}

export function useGenerateBracket(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}

export function useApproveBracket(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}

export function useFinalizeRound(seasonId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<BracketAdminResponse>(`/admin/seasons/${seasonId}/bracket/finalize-round`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminBracket", seasonId] }),
  });
}
