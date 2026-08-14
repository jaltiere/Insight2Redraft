export interface AdminSection {
  to: string;
  label: string;
  desc: string;
  superOnly?: boolean;
}

export const adminSections: AdminSection[] = [
  { to: "/admin/seasons", label: "Seasons", desc: "Create & edit seasons, add leagues, sync." },
  { to: "/admin/owners", label: "Owners", desc: "Owner records & per-team mapping." },
  { to: "/admin/accounts", label: "Accounts", desc: "League-admin accounts & league grants.", superOnly: true },
];

export function visibleSections(role: string | null): AdminSection[] {
  return adminSections.filter((s) => !s.superOnly || role === "super_admin");
}
