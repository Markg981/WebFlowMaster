import * as React from 'react';

/**
 * Gives the focus back to whatever had it when a dialog opened.
 *
 * Radix returns it only to a <DialogTrigger>. Most dialogs here open from state, without one, so
 * on close the focus fell to <body>: a keyboard or screen-reader user was sent back to the top of
 * the page every time they dismissed a dialog. A consumer's own handlers still run first and can
 * prevent this, as with Radix.
 */
export function useReturnFocus(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const opener = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = opener.current;
      opener.current = null;
      // Gone (a menu item that opened it, say): Radix's own behaviour stands.
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
