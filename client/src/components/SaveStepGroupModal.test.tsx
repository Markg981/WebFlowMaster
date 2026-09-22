import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SaveStepGroupModal from './SaveStepGroupModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      return options?.count !== undefined ? text.replace('{{count}}', String(options.count)) : text;
    },
  }),
}));

/**
 * Where a step group comes from: the builder, because a group is an ordinary sequence and the
 * builder is where sequences are built.
 */

describe('SaveStepGroupModal', () => {
  it('says what saving will mean, including that editing it later moves every caller', () => {
    render(<SaveStepGroupModal isOpen onClose={() => {}} stepCount={6} onSave={vi.fn()} />);

    expect(screen.getByText(/6 steps become a group/i)).toBeInTheDocument();
    expect(screen.getByText(/changes every test that calls it/i)).toBeInTheDocument();
  });

  it('saves the name and the description', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SaveStepGroupModal isOpen onClose={onClose} stepCount={2} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Login  ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Signs in as the test user' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: 'Login', description: 'Signs in as the test user' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses a nameless group, because the name is how a test calls it', async () => {
    const onSave = vi.fn();
    render(<SaveStepGroupModal isOpen onClose={() => {}} stepCount={2} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Give the group a name/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows what the server refused and stays open', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('A step group cannot call another step group.'));
    const onClose = vi.fn();
    render(<SaveStepGroupModal isOpen onClose={onClose} stepCount={2} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Outer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A step group cannot call another step group.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
