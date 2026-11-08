import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

function setup(requireText?: string) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Delete?"
      confirmLabel="Delete"
      destructive
      requireText={requireText}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('ConfirmDialog strong confirmation', () => {
  it('has no text field and an enabled button without requireText', () => {
    const onConfirm = setup();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the button disabled until the exact text is typed', () => {
    const onConfirm = setup('Acme');
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acm' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is case sensitive and ignores surrounding spaces', () => {
    setup('Acme');
    const button = screen.getByRole('button', { name: 'Delete' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acme' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Acme ' } });
    expect(button).toBeEnabled();
  });
});
