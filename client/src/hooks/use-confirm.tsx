import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  destructive?: boolean;
}

/**
 * `window.confirm` that looks like the rest of the app and can be awaited.
 *
 * `const { confirm, confirmDialog } = useConfirm();` render `{confirmDialog}` once in the
 * component and `if (!(await confirm({ title })))` where the native prompt used to be.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={options?.title}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      destructive={options?.destructive}
      onConfirm={() => settle(true)}
    />
  );

  return { confirm, confirmDialog };
}
