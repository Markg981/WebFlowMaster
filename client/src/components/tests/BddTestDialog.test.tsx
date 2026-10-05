import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BddTestDialog from './BddTestDialog';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const bdd = {
  language: 'it',
  source: '# language: it\nFunzionalità: F\nScenario: S\nDato un conto',
  uri: 'sample.feature',
  scenarioLine: 3,
  mode: 'manual' as const,
};
function wrap(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, queryFn: async () => ({ profiles: [] }) },
    },
  });
  client.setQueryData(['/api/bdd/profiles'], { profiles: [] });
  return <QueryClientProvider client={client}>{child}</QueryClientProvider>;
}
describe('BddTestDialog', () => {
  it.each([
    ['Gherkin source', 'unsaved source'],
    ['Dialect', 'en'],
    ['Logical feature filename', 'changed.feature'],
    ['Scenario line', '5'],
    ['Examples row line (optional)', '7'],
    ['Execution mode', 'cucumber'],
  ])('requires saving changes to %s before converting stored steps', (label, value) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(wrap(<BddTestDialog test={{ id: 1, name: 'A', bdd }} onClose={vi.fn()} onSaved={vi.fn()} />));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByTestId('bdd-convert-manual')).toBeDisabled();
    expect(screen.getByText('Save your changes before converting to an editable manual test.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bdd-convert-manual'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['bdd-save', 'bdd-convert-manual'])('freezes all editor controls while %s is pending', async (button) => {
    const binding = { id: '00000000-0000-4000-8000-000000000001', revision: 'r1' };
    const definition = { ...bdd, mode: 'cucumber' as const, binding };
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['/api/bdd/profiles'], { profiles: [{ ...binding, name: 'QA support', projectId: null }] });
    let resolve!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<QueryClientProvider client={client}><BddTestDialog test={{ id: 1, name: 'A', bdd: definition }} onClose={onClose} onSaved={onSaved} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId(button));
    for (const label of ['Gherkin source', 'Dialect', 'Logical feature filename', 'Scenario line', 'Examples row line (optional)', 'Execution mode', 'Execution profile']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByTestId('bdd-save')).toBeDisabled();
    expect(screen.getByTestId('bdd-convert-manual')).toBeDisabled();
    resolve({ ok: true, json: async () => ({}) });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Gherkin source')).toBeEnabled();
  });
  it('ignores a previous test save completion after switching identities', async () => {
    let resolve: any;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['/api/bdd/profiles'], { profiles: [] });
    const onSaved = vi.fn(),
      onClose = vi.fn();
    const view = (id: number) => (
      <QueryClientProvider client={client}>
        <BddTestDialog test={{ id, name: `Test ${id}`, bdd }} onClose={onClose} onSaved={onSaved} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(1));
    fireEvent.click(screen.getByText('Save and validate'));
    rerender(view(2));
    resolve({ ok: true, json: async () => ({}) });
    await waitFor(() => expect(screen.getByTestId('bdd-save')).toBeEnabled());
    await new Promise((r) => setTimeout(r, 0));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('saves source and selector together without submitting independently edited steps', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      wrap(<BddTestDialog test={{ id: 1, name: 'A', bdd }} onClose={vi.fn()} onSaved={vi.fn()} />),
    );
    fireEvent.change(screen.getByLabelText('Scenario line'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Gherkin source'), {
      target: { value: bdd.source + '\n' },
    });
    fireEvent.click(screen.getByText('Save and validate'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.bdd).toMatchObject({ source: bdd.source + '\n', scenarioLine: 4 });
    expect(body.sequence).toBeUndefined();
  });
  it('resets source and mode when another test is selected', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, queryFn: async () => ({ profiles: [] }) } },
    });
    client.setQueryData(['/api/bdd/profiles'], { profiles: [] });
    const view = (id: number, source: string) => (
      <QueryClientProvider client={client}>
        <BddTestDialog
          test={{ id, name: 'A', bdd: { ...bdd, source } }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(view(1, bdd.source));
    fireEvent.change(screen.getByLabelText('Gherkin source'), { target: { value: 'unsaved' } });
    rerender(view(2, 'Feature: Second'));
    expect(screen.getByLabelText('Gherkin source')).toHaveValue('Feature: Second');
  });
  it('requires explicit conversion to remove BDD metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      wrap(<BddTestDialog test={{ id: 1, name: 'A', bdd }} onClose={vi.fn()} onSaved={vi.fn()} />),
    );
    fireEvent.click(screen.getByText('Convert to editable manual test'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ bdd: null });
  });
});
