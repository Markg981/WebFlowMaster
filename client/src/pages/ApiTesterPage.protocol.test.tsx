import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiTesterPage from './ApiTesterPage';

const mocks = vi.hoisted(() => ({ api: vi.fn(), user: { id: 1, organizationId: 1, role: 'owner' } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/lib/monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({ default: ({ value, onChange }: any) => <textarea aria-label="Raw editor" value={value} onChange={event => onChange?.(event.target.value)} /> }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: any) => <div>{children}</div>, TabsList: ({ children }: any) => <div>{children}</div>, TabsTrigger: ({ children }: any) => <button>{children}</button>, TabsContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/api-tester/HistoryPanel', () => ({ HistoryPanel: () => null }));
vi.mock('@/components/api-tester/SavedTestsPanel', () => ({ SavedTestsPanel: ({ savedTests, onLoadTest, onExportTest }: any) => <>{savedTests.map((test: any) => <div key={test.id}><button onClick={() => onLoadTest(test)}>Load {test.name}</button><button onClick={() => onExportTest(test)}>Export {test.name}</button></div>)}</> }));
vi.mock('@/components/api-tester/SaveApiTestModal', () => ({ SaveApiTestModal: ({ isOpen, onSave }: any) => isOpen ? <button onClick={() => onSave('Saved', null)}>Confirm save</button> : null }));
vi.mock('@/components/api-tester/AssertionEditor', () => ({ AssertionEditor: () => null }));
vi.mock('@/components/api-tester/ExtractionEditor', () => ({ ExtractionEditor: () => null }));
vi.mock('@/components/api-tester/PerformanceEditor', () => ({ PerformanceEditor: () => null }));
vi.mock('@/components/api-tester/AuthorizationPanel', () => ({ AuthorizationPanel: () => null, emptyAuthParamsFor: () => undefined }));
vi.mock('@/components/EnvironmentSelect', () => ({ EnvironmentSelect: () => null }));

const config = { timeoutMs: 45000, grpcMode: 'bidi', tls: { rootCa: '{{secret_ca}}', clientCertificate: '{{secret_cert}}', clientKey: '{{secret_key}}' } };
const body = JSON.stringify({ steps: [{ type: 'receive' }, { type: 'capture', name: 'token', property: 'token' }, { type: 'send', message: '{{capture.token}}' }, { type: 'end' }] });
const saved = { id: 10, name: 'Stream', method: 'GRPC', url: 'grpcs://service.test:443/shop.Service/Chat', requestBody: body, bodyType: 'raw', bodyRawContentType: 'application/json', protocolConfig: config, protoDefinition: 'syntax = "proto3";', assertions: [], extractions: [] };
beforeEach(() => {
  mocks.user = { id: 1, organizationId: 1, role: 'owner' };
  mocks.api.mockReset().mockImplementation(async (method: string, url: string, payload: any) => ({ ok: true, json: async () => url === '/api/api-tests' && method === 'GET' ? [saved, { ...saved, id: 11, name: 'Legacy', protocolConfig: null, requestBody: '{"messages":"ordinary request field"}' }] : url === '/api/proxy-api-request' ? { success: true, status: 0, body: { messages: [{ token: 'challenge' }], last: { token: 'challenge' }, count: 1, captures: { token: 'challenge' } }, headers: {} } : method === 'PUT' ? { ...saved, ...payload } : [] }));
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><ApiTesterPage /></QueryClientProvider>;
  return { ...render(tree()), tree };
}
describe('API tester protocol persistence and execution', () => {
  it('allows a TLS target provided by an environment URL variable', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Load Stream' }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: '{{baseUrl}}/shop.Service/Chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/proxy-api-request', expect.objectContaining({ url: '{{baseUrl}}/shop.Service/Chat', protocolConfig: config })));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PUT', '/api/api-tests/10', expect.objectContaining({ url: '{{baseUrl}}/shop.Service/Chat', protocolConfig: config })));
  });
  it('exports the service definition and protocol secret references with the raw body', async () => {
    const download = vi.fn(() => 'blob:download'); URL.createObjectURL = download; URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Export Stream' }));
    const exported = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(download.mock.calls[0][0]); });
    expect(JSON.parse(exported)).toMatchObject({ protocolConfig: config, protoDefinition: saved.protoDefinition, requestBody: body });
    click.mockRestore();
  });
  it('loads config, keeps lazy capture body, forwards it on run/save and shows transcript', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Load Stream' }));
    expect(screen.getByLabelText('Client key secret reference')).toHaveValue('{{secret_key}}');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/proxy-api-request', expect.objectContaining({ protocolConfig: config, body: JSON.parse(body) })));
    expect(await screen.findByTestId('protocol-transcript')).toHaveTextContent('challenge');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PUT', '/api/api-tests/10', expect.objectContaining({ protocolConfig: config, requestBody: body })));
  });
  it('resets protocol settings on another test and preserves ordinary raw JSON unchanged', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Load Stream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load Legacy' }));
    expect(screen.getByLabelText('Client key secret reference')).toHaveValue('');
    expect(screen.queryByLabelText('Step 1 message')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PUT', '/api/api-tests/11', expect.objectContaining({ protocolConfig: null, requestBody: '{"messages":"ordinary request field"}' })));
  });
  it('clears drafts across organization identity changes', async () => {
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: 'Load Stream' }));
    mocks.user = { id: 2, organizationId: 2, role: 'owner' }; view.rerender(view.tree());
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.queryByLabelText('Client key secret reference')).toBeNull();
  });
});
