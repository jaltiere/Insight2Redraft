import { useState } from "react";
import { useOwners } from "@/features/adminOwners";
import { useDebounced } from "@/lib/useDebounced";
import { ownerName } from "@/features/standings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerFormDialog } from "./OwnerFormDialog";
import type { OwnerAdminResponse } from "@/types/api";

export function OwnerCombobox({
  sleeperName, onSelect, onCancel,
}: {
  sleeperName?: string | null;
  onSelect: (owner: OwnerAdminResponse) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text, 250);
  const results = useOwners(q, true);

  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={text}
        placeholder="Search owners…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="rounded-md border bg-card">
        {results.data?.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => void onSelect(o)}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {ownerName(o)}
            {o.email ? <span className="text-muted-foreground"> · {o.email}</span> : null}
          </button>
        ))}
        <OwnerFormDialog
          mode="create"
          prefillFirstName={sleeperName ?? ""}
          onCreated={(o) => void onSelect(o)}
          trigger={
            <button
              type="button"
              className="block w-full px-2 py-1 text-left text-sm font-medium text-primary hover:bg-muted"
            >
              ＋ Create {sleeperName ? `"${sleeperName}"` : "new owner"}
            </button>
          }
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
