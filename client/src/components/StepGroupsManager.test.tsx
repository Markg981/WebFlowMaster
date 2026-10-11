import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StepGroupsManager, { type WebStepGroup } from './StepGroupsManager';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {}))
        text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

/**
 * The web step groups, looked after from the builder: which tests call each, a rename, new
 * steps saved over the old ones from the builder, and a deletion that is refused — by name —
 * while tests still call the group.
 */

const fetchMock = vi.fn();
let usage: Record<string, Array<{ id: number; name: string }>> = {};

const groups: WebStepGroup[] = [
  { id: 'g1', name: 'Login', description: 'Signs in', sequence: [{ id: 's1' }, { id: 's2' }] },
  { id: 'g2', name: 'Pick customer', description: null, sequence: [{ id: 's3' }] },
];

const step = { id: 'b1', action: { id: 'click' }, value: '' };

beforeEach(() => {
  usage = {
    g1: [
      { id: 7, name: 'Checkout' },
      { id: 8, name: 'Profile' },
    ],
    g2: [],
  };
  mockToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const usageMatch = url.match(/^\/api\/step-groups\/([^/]+)\/usage$/);
    if (usageMatch) return { ok: true, json: async () => usage[usageMatch[1]] ?? [] };
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ ...groups[0], ...body }) };
    }
    if (init?.method === 'DELETE') return { ok: true, json: async () => ({ success: true }) };
    return { ok: true, json: async () => groups };
  });
  vi.stubGlobal('fetch', fetchMock);
});

function renderManager(
  props: Partial<React.ComponentProps<typeof StepGroupsManager>> = {},
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const onOpenChange = vi.fn();
  const onOpenInBuilder = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <StepGroupsManager
        open
        onOpenChange={onOpenChange}
        groups={groups}
        builderSequence={[]}
        onOpenInBuilder={onOpenInBuilder}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange, onOpenInBuilder, client };
}

const callsWith = (method: string) =>
  fetchMock.mock.calls.filter(([, init]: any[]) => init?.method === method);

describe('StepGroupsManager', () => {
  it('lists the groups with their step counts', () => {
    renderManager();

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('Signs in')).toBeInTheDocument();
    expect(screen.getByText('2 steps')).toBeInTheDocument();
    expect(screen.getByText('Pick customer')).toBeInTheDocument();
    expect(screen.getByText('1 steps')).toBeInTheDocument();
  });

  it('says which tests call a group, and when none does', async () => {
    renderManager();

    fireEvent.click(screen.getAllByRole('button', { name: 'Where used' })[0]);
    expect(await screen.findByText('Called by 2 tests:')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/step-groups/g1/usage');

    fireEvent.click(screen.getByRole('button', { name: 'Where used' }));
    expect(await screen.findByText('No test calls this group yet.')).toBeInTheDocument();
  });

  it('renames a group and keeps its steps unless asked to replace them', async () => {
    const { client } = renderManager();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(screen.getAllByLabelText('Edit')[0]);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sign in' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(callsWith('PUT')).toHaveLength(1));
    const [url, init] = callsWith('PUT')[0];
    expect(url).toBe('/api/step-groups/g1');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Sign in', description: null });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['stepGroups'] }),
      ),
    );
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Step group saved' }));
  });

  it("saves the builder's steps over the group's when the box is ticked", async () => {
    renderManager({ builderSequence: [step, step] });

    fireEvent.click(screen.getAllByLabelText('Edit')[0]);
    fireEvent.click(screen.getByLabelText('Replace its steps with the 2 steps now in the builder'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(callsWith('PUT')).toHaveLength(1));
    expect(JSON.parse(String(callsWith('PUT')[0][1].body))).toEqual({
      name: 'Login',
      description: 'Signs in',
      sequence: [step, step],
    });
  });

  it('cannot replace steps with an empty builder, and says what to do instead', () => {
    renderManager();

    fireEvent.click(screen.getAllByLabelText('Edit')[0]);

    expect(
      screen.getByLabelText('Replace its steps with the 0 steps now in the builder'),
    ).toBeDisabled();
    expect(screen.getByText(/open it in the builder, edit them there/)).toBeInTheDocument();
  });

  it('refuses an empty name before asking the server', () => {
    renderManager();

    fireEvent.click(screen.getAllByLabelText('Edit')[0]);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('A step group needs a name.');
    expect(callsWith('PUT')).toHaveLength(0);
  });

  it("puts a group's steps in an empty builder straight away and closes", () => {
    const { onOpenInBuilder, onOpenChange } = renderManager();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open in builder' })[0]);

    expect(onOpenInBuilder).toHaveBeenCalledWith(groups[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Step group opened' }));
  });

  it('asks before replacing steps the builder already holds', async () => {
    const { onOpenInBuilder } = renderManager({ builderSequence: [step] });

    fireEvent.click(screen.getAllByRole('button', { name: 'Open in builder' })[0]);

    expect(await screen.findByText('Open “Login” in the builder?')).toBeInTheDocument();
    expect(onOpenInBuilder).not.toHaveBeenCalled();
    // The confirming button carries the same label; it is the one inside the alert dialog.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Open in builder',
      )!,
    );
    await waitFor(() => expect(onOpenInBuilder).toHaveBeenCalledWith(groups[0]));
  });

  it('will not offer to delete a group that tests still call, and names them', async () => {
    renderManager();

    fireEvent.click(screen.getAllByLabelText('Delete')[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '“Login” cannot be deleted while tests still call it: Checkout, Profile.',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(callsWith('DELETE')).toHaveLength(0);
  });

  it('asks before deleting a group nothing calls, then deletes it', async () => {
    const { client } = renderManager();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(screen.getAllByLabelText('Delete')[1]);

    expect(await screen.findByText('Delete step group “Pick customer”?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(callsWith('DELETE')).toHaveLength(1));
    expect(callsWith('DELETE')[0][0]).toBe('/api/step-groups/g2');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['stepGroups'] }),
      ),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Step group deleted' }),
    );
  });

  it("repeats the server's refusal when a test started calling the group meanwhile", async () => {
    renderManager();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE')
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'This step group is still called by 1 test(s).',
            tests: ['Checkout'],
          }),
        };
      return { ok: true, json: async () => [] };
    });

    fireEvent.click(screen.getAllByLabelText('Delete')[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This step group is still called by 1 test(s). Checkout',
    );
  });
});
