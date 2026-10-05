import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TestFilesDialog } from './TestFilesDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? '')) : _key,
  }),
}));

/** Export a link; import only after a preview of what would change. */

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderDialog(canEdit = true, onImported = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } } });
  client.setQueryData(['/api/bdd/profiles'], { profiles: [{ id: '00000000-0000-4000-8000-000000000001', name: 'QA support', revision: 'r1', projectId: null }] });
  render(
    <QueryClientProvider client={client}>
      <TestFilesDialog open onOpenChange={() => {}} canEdit={canEdit} onImported={onImported} />
    </QueryClientProvider>,
  );
  return onImported;
}

describe('TestFilesDialog', () => {
 it('discards an old preview when content changes while the request is pending',async()=>{
 let resolve:any;fetchMock.mockReturnValue(new Promise(r=>{resolve=r}));renderDialog();fireEvent.change(screen.getByTestId('test-files-content'),{target:{value:'old'}});fireEvent.click(screen.getByTestId('test-files-preview'));fireEvent.change(screen.getByTestId('test-files-content'),{target:{value:'new'}});resolve({ok:true,json:async()=>({dryRun:true,results:[{kind:'test',name:'Old test',outcome:'created'}]})});await waitFor(()=>expect(screen.getByTestId('test-files-preview')).toBeEnabled());expect(screen.getByTestId('test-files-import')).toBeDisabled();expect(screen.queryByText('Old test')).toBeNull();
 });
  it.each(['gherkin', 'bundle'])('explicitly maps Cucumber imports to the destination profile for %s', async (format) => {
    fetchMock.mockResolvedValue({ok:true,json:async()=>({dryRun:true,results:[{kind:'test',name:'Italian scenario',outcome:'created',gherkin:{language:'it',scenario:'Scenario',rule:'Rule name',tags:['@regression'],arguments:['docString','dataTable'],mode:'cucumber'}}]})});
    renderDialog();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: format } });
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'cucumber' } });
    expect(screen.getByTestId('test-files-preview')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Execution profile'), { target: { value: '00000000-0000-4000-8000-000000000001' } });
    fireEvent.change(screen.getByTestId('test-files-content'), { target: { value: 'Feature: F' } });
    fireEvent.click(screen.getByTestId('test-files-preview'));
    await screen.findByText('Italian scenario');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).bdd).toEqual({mode:'cucumber',binding:{id:'00000000-0000-4000-8000-000000000001',revision:'r1'}});
    expect(screen.getByTestId('test-files-results')).toHaveTextContent('it');
    expect(screen.getByTestId('test-files-results')).toHaveTextContent('Rule name');
    expect(screen.getByTestId('test-files-results')).toHaveTextContent('@regression');
  });
  it('previews Gherkin with explicit format and explains manual execution', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ dryRun: true, results: [] }) });
    renderDialog();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'gherkin' } });
    expect(screen.getByText(/Standard Gherkin dialects/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('test-files-content'), { target: { value: 'Feature: F\nScenario: S\nGiven a' } });
    fireEvent.click(screen.getByTestId('test-files-preview'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ format: 'gherkin', dryRun: true });
  });
  it('downloads the export from a link', () => {
    renderDialog();
    expect(screen.getByTestId('test-files-export')).toHaveAttribute('href', '/api/tests/export?format=yaml');
  });

  it('imports only after a preview, and says what happened to each test', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dryRun: true, results: [{ kind: 'test', name: 'Login', outcome: 'updated' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dryRun: false, results: [{ kind: 'test', name: 'Login', outcome: 'updated' }] }) });
    const onImported = renderDialog();
    expect(screen.getByTestId('test-files-import')).toBeDisabled();
    fireEvent.change(screen.getByTestId('test-files-content'), { target: { value: 'kind: webflowmaster/tests' } });
    fireEvent.click(screen.getByTestId('test-files-preview'));
    expect(await screen.findByTestId('test-files-results')).toHaveTextContent('Login');
    fireEvent.click(screen.getByTestId('test-files-import'));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dryRun: true, projectId: null });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ dryRun: false });
  });

  it('offers only the export to a viewer', () => {
    renderDialog(false);
    expect(screen.queryByTestId('test-files-content')).toBeNull();
  });
});


