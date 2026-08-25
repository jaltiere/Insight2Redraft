import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  AccountAdminResponse, AccountCreateBody, LeagueAdminRef, LeagueGrantRef,
} from "@/types/api";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiClient.get<AccountAdminResponse[]>("/admin/accounts"),
  });
}

/** Only fetched while the grant dialog is open. */
export function useAdminLeagues(enabled: boolean) {
  return useQuery({
    queryKey: ["adminLeagues"],
    queryFn: () => apiClient.get<LeagueAdminRef[]>("/admin/leagues"),
    enabled,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AccountCreateBody) =>
      apiClient.post<AccountAdminResponse>("/admin/accounts", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useResetPassword(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiClient.patch<AccountAdminResponse>(`/admin/accounts/${accountId}`, { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => apiClient.delete<void>(`/admin/accounts/${accountId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useGrantLeague(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.post<LeagueGrantRef>(`/admin/accounts/${accountId}/grants`, { league_id: leagueId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useRevokeGrant(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagueId: number) =>
      apiClient.delete<void>(`/admin/accounts/${accountId}/grants/${leagueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}
