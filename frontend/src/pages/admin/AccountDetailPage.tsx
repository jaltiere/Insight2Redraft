import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAccounts, useDeleteAccount } from "@/features/adminAccounts";
import { useOwner } from "@/features/adminOwners";
import { useAuth } from "@/auth/useAuth";
import { ownerName } from "@/features/standings";
import { isApiError } from "@/lib/api-client";
import { RolePill } from "@/components/RolePill";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

export function AccountDetailPage() {
  const raw = useParams().id;
  const id = Number(raw);
  const valid = raw !== undefined && raw !== "" && !Number.isNaN(id);
  const navigate = useNavigate();
  const { account: me } = useAuth();

  const accounts = useAccounts();
  const account = valid ? accounts.data?.find((a) => a.id === id) : undefined;

  const del = useDeleteAccount();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // hooks must run unconditionally; useOwner no-ops on null
  const owner = useOwner(account?.owner_id ?? null);

  if (!valid) return <NotFound title="Account not found" message="We couldn't find that account." />;
  if (accounts.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (accounts.isError) return <p className="text-destructive">Couldn't load accounts.</p>;
  if (!account) return <NotFound title="Account not found" message="We couldn't find that account." />;

  const isSelf = me?.id === account.id;

  async function onDelete() {
    setDeleteError(null);
    try {
      await del.mutateAsync(id);
      setConfirmOpen(false);
      navigate("/admin/accounts");
    } catch (e) {
      setDeleteError(isApiError(e) ? e.detail : "Delete failed");
    }
  }

  return (
    <div>
      <div className="mb-1">
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate(-1)}>← Back</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{account.email}</h1>
        <RolePill role={account.role} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Owner: {account.owner_id === null ? "not linked" : owner.data ? ownerName(owner.data) : "…"}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <ResetPasswordDialog
          accountId={account.id}
          trigger={<Button variant="outline">Reset password</Button>}
        />
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => { setConfirmOpen(o); setDeleteError(null); }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={isSelf}>Delete account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {account.email}?</DialogTitle>
              <DialogDescription>
                This removes the account and every league grant it holds.
              </DialogDescription>
            </DialogHeader>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isSelf && (
        <p className="mt-2 text-sm text-muted-foreground">
          You can't delete the account you're signed in with.
        </p>
      )}
    </div>
  );
}
