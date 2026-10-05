import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileGroupDialog from './MobileGroupDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const fetchMock = vi.fn();
const group = {
  id: 'login',
  name: 'Login',
  description: '',
  platform: 'android' as const,
  projectId: 3,
  steps: [{ id: 'back', action: 'back' as const }],
};
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
describe('native group editing', () => {
  it('saves the platform, project and shared native steps together', async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        json: async () => (init ? group : [{ id: 3, name: 'Members', access: 'editor' }]),
      }),
    );
    const onSaved = vi.fn();
    render(<MobileGroupDialog group={group} open onClose={() => {}} onSaved={onSaved} />);
    await screen.findByText('Members');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Login updated' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(url).toBe('/api/mobile-step-groups/login');
    expect(JSON.parse(init.body)).toMatchObject({
      name: 'Login updated',
      platform: 'android',
      projectId: 3,
      steps: group.steps,
    });
  });
  it('keeps the dialog open and reports rejected platform changes', async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve({
        ok: !init,
        json: async () => (init ? { error: 'The group is referenced by a mobile test.' } : []),
      }),
    );
    const onSaved = vi.fn();
    render(<MobileGroupDialog group={group} open onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'ios' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The group is referenced by a mobile test.',
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
