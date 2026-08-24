import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { OwnerProfile } from "@/types/api";

export function useOwnerProfile(id: number | null) {
  return useQuery({
    queryKey: ["ownerProfile", id],
    queryFn: () => apiClient.get<OwnerProfile>(`/owners/${id}`),
    enabled: id !== null,
  });
}
