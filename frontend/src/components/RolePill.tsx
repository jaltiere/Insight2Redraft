import { Badge } from "@/components/ui/badge";
import type { AccountRole } from "@/types/api";

const LABEL: Record<AccountRole, string> = {
  super_admin: "Super-admin",
  league_admin: "League-admin",
};

export function RolePill({ role }: { role: AccountRole | null }) {
  if (!role) return null;
  return <Badge variant="secondary">{LABEL[role]}</Badge>;
}
