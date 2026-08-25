import { useState } from "react";
import type { ReactNode } from "react";
import { useResetPassword } from "@/features/adminAccounts";
import { isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const MIN_PASSWORD = 12;

export function ResetPasswordDialog({
  accountId, trigger,
}: {
  accountId: number; trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reset = useResetPassword(accountId);

  const invalid =
    password.length < MIN_PASSWORD
      ? `Password must be at least ${MIN_PASSWORD} characters.`
      : password !== confirm
        ? "Passwords do not match."
        : null;

  async function onSubmit() {
    setError(null);
    try {
      await reset.mutateAsync(password);
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.detail : "Reset failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setPassword(""); setConfirm(""); setError(null); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Sets a new password for this account. Tell the account holder out of band.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
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
          <Button onClick={onSubmit} disabled={reset.isPending || invalid !== null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
