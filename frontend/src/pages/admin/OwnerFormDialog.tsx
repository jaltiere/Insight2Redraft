import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateOwner, useUpdateOwner } from "@/features/adminOwners";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { OwnerAdminResponse } from "@/types/api";

type Props = {
  trigger: ReactNode;
  mode: "create" | "edit";
  owner?: OwnerAdminResponse;
  prefillFirstName?: string;
  onCreated?: (o: OwnerAdminResponse) => void;
};

export function OwnerFormDialog({ trigger, mode, owner, prefillFirstName, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateOwner();
  const update = useUpdateOwner(owner?.id ?? 0);
  const pending = create.isPending || update.isPending;

  function reset() {
    setFirst(owner?.first_name ?? prefillFirstName ?? "");
    setLast(owner?.last_name ?? "");
    setEmail(owner?.email ?? "");
    setDisplay(owner?.display_name ?? "");
    setNotes(owner?.notes ?? "");
    setError(null);
  }

  async function onSubmit() {
    setError(null);
    const body = {
      first_name: first, last_name: last,
      email: email || null, display_name: display || null, notes: notes || null,
    };
    try {
      if (mode === "edit") {
        await update.mutateAsync(body);
      } else {
        const created = await create.mutateAsync(body);
        onCreated?.(created);
      }
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Save failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit owner" : "New owner"}</DialogTitle>
          <DialogDescription>Owner identity used across leagues and seasons.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">First name</span>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Last name</span>
            <Input value={last} onChange={(e) => setLast(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Email</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Display name</span>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={pending || first.trim() === "" || last.trim() === ""}>
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
