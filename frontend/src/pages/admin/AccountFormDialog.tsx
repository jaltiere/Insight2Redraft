import { useState } from "react";
import type { ReactNode } from "react";
import { useCreateAccount } from "@/features/adminAccounts";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { OwnerCombobox } from "./OwnerCombobox";
import type { OwnerAdminResponse } from "@/types/api";

const MIN_PASSWORD = 12;

/** First problem with the form, or null when it is submittable. */
function formError(email: string, password: string, confirm: string): string | null {
  if (email.trim() === "") return "Email is required.";
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

export function AccountFormDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [owner, setOwner] = useState<OwnerAdminResponse | null>(null);
  const [pickingOwner, setPickingOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAccount();
  const invalid = formError(email, password, confirm);

  function reset() {
    setEmail(""); setPassword(""); setConfirm("");
    setOwner(null); setPickingOwner(false); setError(null);
  }

  async function onSubmit() {
    setError(null);
    try {
      await create.mutateAsync({ email, password, owner_id: owner?.id ?? null });
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Create failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Creates a league-admin account. Grant it leagues from the account's page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Owner</span>
            {pickingOwner ? (
              <OwnerCombobox
                onSelect={(o) => { setOwner(o); setPickingOwner(false); }}
                onCancel={() => setPickingOwner(false)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className={owner ? "text-foreground" : "text-muted-foreground"}>
                  {owner ? ownerName(owner) : "Not linked"}
                </span>
                <Button variant="link" size="sm" onClick={() => setPickingOwner(true)}>
                  {owner ? "change" : "link owner"}
                </Button>
              </div>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Password</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Confirm password</span>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {invalid && <p className="text-sm text-muted-foreground">{invalid}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={onSubmit} disabled={create.isPending || invalid !== null}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
