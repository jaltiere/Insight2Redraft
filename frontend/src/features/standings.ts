import type { OwnerRef } from "@/types/api";

export function ownerName(owner: OwnerRef | null): string {
  if (!owner) return "—";
  return owner.display_name ?? `${owner.first_name} ${owner.last_name}`;
}

export function teamRecord(t: { wins: number; losses: number; ties: number }): string {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

export function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
