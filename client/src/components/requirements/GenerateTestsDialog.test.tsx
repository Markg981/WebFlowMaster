import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GenerateTestsDialog from './GenerateTestsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'it-IT' },
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/** Tests proposed from a story: read, corrected, chosen, and only then created. */

const fetchMock = vi.fn();
let createStatus = 201;

beforeEach(() => {
  createStatus = 201;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.endsWith('/test-proposals')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          source: 'tracker',
          story: { key: 'SHOP-2', title: 'Pay by card', description: 'As a shopper I pay by card.', acceptance: 'A valid card is charged' },
          proposals: [
            { title: 'Pay with a valid card', kind: 'positive', criterion: 'A valid card is charged', preconditions: 'A cart with one item', steps: [{ action: 'Press Pay', expected: 'Paid' }] },
            { title: 'Refuse an expired card', kind: 'negative', criterion: '', preconditions: '', steps: [{ action: 'Enter an expired card', expected: 'Card expired' }] },
          ],
        }),
      });
    }
    return Promise.resolve({
      ok: createStatus < 400,
      status: createStatus,
      json: async () =>
        createStatus === 409 ? { error: 'A test with this name already exists: Pay with a valid card.', names: ['Pay with a valid card'] } : { created: [{ id: 1, name: 'x' }] },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderDialog = (onCreated = vi.fn()) =>
  render(<GenerateTestsDialog requirement={{ id: 7, key: 'SHOP-2', title: 'Pay by card' }} onClose={() => {}} onCreated={onCreated} />);

describe('GenerateTestsDialog', () => {
  it('asks in the interface language and shows what the story said', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('How many at most'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Propose tests'));
    expect(await screen.findByDisplayValue('Pay with a valid card')).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ language: 'it', count: 4 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/requirements/7/test-proposals');
    expect(screen.getByText('Written from SHOP-2 as the tracker has it now')).toBeTruthy();
    expect(screen.getByText('Covers: A valid card is charged')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('creates only the chosen cases, as edited, with the preconditions first', async () => {
    const onCreated = vi.fn();
    renderDialog(onCreated);
    fireEvent.click(screen.getByText('Propose tests'));
    fireEvent.change(await screen.findByLabelText('Name of test 1'), { target: { value: 'Pay by Visa' } });
    fireEvent.change(screen.getByLabelText('Expected result 1 of test 1'), { target: { value: 'The order shows Paid' } });
    fireEvent.click(screen.getAllByText('Add step')[0]);
    fireEvent.change(screen.getByLabelText('Action 2 of test 1'), { target: { value: 'Open My orders' } });
    fireEvent.click(screen.getByLabelText('Keep Refuse an expired card'));
    fireEvent.click(screen.getByText('Create 1 tests'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(1));
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/generated-tests'))!;
    expect(url).toBe('/api/requirements/7/generated-tests');
    expect(JSON.parse(init.body)).toEqual({
      tests: [
        {
          name: 'Pay by Visa',
          steps: [
            { action: 'Preconditions: A cart with one item', expected: '' },
            { action: 'Press Pay', expected: 'The order shows Paid' },
            { action: 'Open My orders', expected: '' },
          ],
        },
      ],
    });
  });

  it('names a test whose name is taken, and refuses a case left without steps', async () => {
    createStatus = 409;
    renderDialog();
    fireEvent.click(screen.getByText('Propose tests'));
    await screen.findByDisplayValue('Pay with a valid card');
    fireEvent.click(screen.getByText('Create 2 tests'));
    expect((await screen.findByRole('alert')).textContent).toContain('Pay with a valid card');
    expect(screen.getByLabelText('Name of test 1').className).toContain('border-destructive');

    fireEvent.click(screen.getByLabelText('Remove step 1 of test 2'));
    fireEvent.click(screen.getByText('Create 2 tests'));
    expect(screen.getByRole('alert').textContent).toBe('Every chosen test needs at least one step.');
  });
});
