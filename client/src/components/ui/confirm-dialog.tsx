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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  /**
   * Strong confirmation: the confirming button stays disabled until the user types this text
   * (the resource name, or a fixed word) exactly. Meant for deletions that cannot be undone.
   */
  requireText?: string;
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
  requireText,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = React.useState('');
  // A fresh question each time the dialog opens or the target changes.
  React.useEffect(() => {
    setTyped('');
  }, [open, requireText]);
  const needsText = !!requireText;
  const textMatches = !needsText || typed.trim() === requireText;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {needsText && (
          <div className="space-y-2">
            <Label htmlFor="confirm-dialog-text">
              {t('common.typeToConfirm', 'Type "{{text}}" to confirm', { text: requireText })}
            </Label>
            <Input
              id="confirm-dialog-text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
              aria-label={t('common.typeToConfirmLabel', 'Confirmation text')}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open while `pending` is true: the caller closes it when done.
              if (pending || !textMatches) {
                event.preventDefault();
                if (!textMatches) return;
              }
              onConfirm();
            }}
            disabled={pending || !textMatches}
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
