import type { ReactNode } from "react";

export function StatChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-card px-3 py-1 text-sm shadow-sm ring-1 ring-border">
      {children}
    </span>
  );
}
