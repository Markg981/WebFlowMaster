import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The confirming button's text; "Confirm" when omitted. */
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** Styles the confirming button as destructive. */
  destructive?: boolean;
  /** Disables the confirming button while the action runs, with a spinner. */
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * The one question before an action that cannot be undone.
 *
 * Several delete, revoke and disable buttons fired on a single click, with no way back: an
 * environment with its secrets, a pipeline's key, someone's second factor. Each screen that
 * did ask had written its own AlertDialog; this is that dialog, once, so the question is
 * cheap to ask and looks the same everywhere. The caller keeps what is about to be acted on
 * in its own state and renders this with `open` while that state is set.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open while `pending` is true: the caller closes it when done.
              if (pending) event.preventDefault();
              onConfirm();
            }}
            disabled={pending}
            className={cn(
              destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {confirmLabel ?? t('common.confirm', 'Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
