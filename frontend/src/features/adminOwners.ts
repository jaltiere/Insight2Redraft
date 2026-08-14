import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  OwnerAdminDetail, OwnerAdminResponse, OwnerCreateBody, OwnerUpdateBody, TeamMappingRow,
} from "@/types/api";

export function useOwners(q: string, enabled = true) {
  return useQuery({
    queryKey: ["owners", q],
    queryFn: () => apiClient.get<OwnerAdminResponse[]>(`/admin/owners?q=${encodeURIComponent(q)}`),
    enabled,
  });
}

export function useOwner(id: number | null) {
  return useQuery({
    queryKey: ["owner", id],
    queryFn: () => apiClient.get<OwnerAdminDetail>(`/admin/owners/${id}`),
    enabled: id !== null,
  });
}

export function useCreateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OwnerCreateBody) => apiClient.post<OwnerAdminResponse>("/admin/owners", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owners"] }),
  });
}

export function useUpdateOwner(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OwnerUpdateBody) => apiClient.patch<OwnerAdminResponse>(`/admin/owners/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", id] });
      qc.invalidateQueries({ queryKey: ["owners"] });
    },
  });
}

export function useTeamMappings(leagueId: number) {
  return useQuery({
    queryKey: ["mappings", leagueId],
    queryFn: () => apiClient.get<TeamMappingRow[]>(`/admin/leagues/${leagueId}/teams`),
  });
}

export function useAssignTeamOwner(leagueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, ownerId }: { teamId: number; ownerId: number }) =>
      apiClient.patch<TeamMappingRow>(`/admin/leagues/${leagueId}/teams/${teamId}`, { owner_id: ownerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mappings", leagueId] }),
  });
}
