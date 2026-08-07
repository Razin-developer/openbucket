import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";

/**
 * Shared destructive-action confirmation dialog — replaces every `window.confirm(...)` in the
 * dashboard with a real in-product AlertDialog (title + explanation + Cancel/destructive Confirm).
 * Guard logic at each call site is unchanged: the action only runs from onConfirm, which the
 * AlertDialogAction only fires when the user actually clicks it.
 */
export function ConfirmDialog({
  open, title, description, confirmLabel = "Delete", cancelLabel = "Cancel", onConfirm, onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
