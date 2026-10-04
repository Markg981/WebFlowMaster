import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportApiTestsDialog } from './ImportApiTestsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? '')) : _key,
  }),
}));

/** Paste, preview, keep what is new, import. */

const fetchMock = vi.fn();
const preview = {
  format: 'openapi',
  title: 'Shop',
  tests: [
    { index: 0, name: 'List orders', method: 'GET', url: '{{baseUrl}}/orders', module: 'orders', exists: true, warnings: [] },
    { index: 1, name: 'Create order', method: 'POST', url: '{{baseUrl}}/orders', module: 'orders', exists: false, warnings: ['Check the body.'] },
  ],
  variables: [{ name: 'baseUrl', value: 'https://shop.example.com', why: 'the address' }],
  warnings: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  render(
    <QueryClientProvider client={client}>
      <ImportApiTestsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe('ImportApiTestsDialog', () => {
  it('uploads a directory bundle, edits logical paths and sends the chosen root', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...preview, format: 'wsdl' }) });
    renderDialog();
    const root = new File(['<definitions/>'], 'service.wsdl');
    const schema = new File(['<schema/>'], 'types.xsd');
    Object.defineProperty(root, 'webkitRelativePath', { value: 'bundle/service.wsdl' });
    Object.defineProperty(schema, 'webkitRelativePath', { value: 'bundle/schemas/types.xsd' });
    Object.defineProperty(root, 'text', { value: async () => '<definitions/>' });
    Object.defineProperty(schema, 'text', { value: async () => '<schema/>' });
    fireEvent.change(screen.getByLabelText('Open a directory…'), { target: { files: [root, schema] } });
    expect(await screen.findByLabelText('Document 2 logical location')).toHaveValue('bundle/schemas/types.xsd');
    fireEvent.change(screen.getByLabelText('Document 2 logical location'), { target: { value: 'https://example.test/types.xsd' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByTestId('import-preview');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ content: '<definitions/>', rootLocation: 'bundle/service.wsdl', documents: [{ location: 'https://example.test/types.xsd', content: '<schema/>' }], dryRun: true });
  });
  it('re-previews a selected SOAP endpoint and imports that same endpoint', async () => {
    const soap = { ...preview, format: 'wsdl', endpoints: [{ id: 'a', label: 'Primary', address: 'https://a.test' }, { id: 'b', label: 'Secondary', address: 'https://b.test' }], selectedEndpoint: 'a' };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => soap }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...soap, selectedEndpoint: 'b' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ created: [], skipped: [], invalid: [] }) });
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: '<definitions/>' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    fireEvent.change(await screen.findByLabelText('SOAP endpoint'), { target: { value: 'b' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('import-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-outcome');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ endpoint: 'b', dryRun: true });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ endpoint: 'b' });
  });
  it('invalidates old endpoint operations when the replacement preview fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...preview, format: 'wsdl', endpoints: [{ id: 'a', label: 'Primary', address: 'https://a.test' }, { id: 'b', label: 'Secondary', address: 'https://b.test' }], selectedEndpoint: 'a' }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Endpoint unavailable' }) });
    renderDialog(); fireEvent.change(screen.getByTestId('import-content'), { target: { value: '<definitions/>' } }); fireEvent.click(screen.getByTestId('import-preview-button'));
    fireEvent.change(await screen.findByLabelText('SOAP endpoint'), { target: { value: 'b' } });
    expect(await screen.findByTestId('import-error')).toHaveTextContent('Endpoint unavailable');
    expect(screen.queryByTestId('import-confirm')).toBeNull();
  });
  it('refuses oversized and excessive bundles before reading or submitting files', async () => {
    renderDialog();
    const files = Array.from({ length: 33 }, (_, i) => new File(['x'], `${i}.xsd`));
    fireEvent.change(screen.getByLabelText('Open a file…'), { target: { files } });
    expect(await screen.findByTestId('import-error')).toHaveTextContent('32 documents');
    const big = new File(['x'], 'large.wsdl'); Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Open a file…'), { target: { files: [big] } });
    expect(await screen.findByTestId('import-error')).toHaveTextContent('10 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('discards an in-flight preview after editing its source', async () => {
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'old' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'new' } });
    finish({ ok: true, json: async () => preview });
    await waitFor(() => expect(screen.getByTestId('import-preview-button')).not.toBeDisabled());
    expect(screen.queryByTestId('import-preview')).toBeNull();
  });
  it('previews, preselects only what is new, and imports the selection', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => preview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ created: [{ id: 1, name: 'Create order' }], skipped: [], invalid: [] }) });
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'openapi: 3.0.0' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    expect(await screen.findByTestId('import-preview')).toHaveTextContent('1 of 2 selected');
    expect(screen.getByTestId('import-variables')).toHaveTextContent('https://shop.example.com');
    expect(screen.getByText('Check the body.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-confirm'));
    expect(await screen.findByTestId('import-outcome')).toHaveTextContent('1 tests imported.');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ select: [1], projectId: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dryRun: true });
  });

  it('says why a file was refused', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Neither OpenAPI 3, Swagger 2 nor a Postman collection.' }) });
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await waitFor(() => expect(screen.getByTestId('import-error')).toHaveTextContent('Neither OpenAPI'));
  });
});
