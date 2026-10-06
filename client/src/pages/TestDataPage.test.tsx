import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DatasetPanel } from '@/components/DatasetPanel';
import TestDataPage from './TestDataPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'editor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** Shared test data: the page that keeps it, and a test's dataset taken from a shared set. */

const customers = { id: 3, name: 'customers', description: 'Known customers', columns: ['email', 'country'], rows: [{ email: 'ann@shop.test', country: 'IT' }, { email: 'bob@shop.test', country: 'DE' }], updatedAt: '2026-10-01T00:00:00Z' };
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

describe('TestDataPage', () => {
  it('loads dataset rows only when editing and does not open on failure',async()=>{
 fetchMock.mockImplementation((url:string)=>url.startsWith('/api/catalog/test-data')?reply({items:[{...customers,rows:undefined,rowCount:2}],total:1,page:1,pageSize:25}):reply({error:'Cannot load'},500));
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TestDataPage /></QueryClientProvider>);
 await screen.findByTestId('data-set');expect(fetchMock.mock.calls.some(([url])=>url==='/api/test-data/3')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Edit customers'}));await screen.findByRole('alert');expect(screen.queryByRole('dialog')).toBeNull();
 fetchMock.mockImplementation(()=>reply(customers));fireEvent.click(screen.getByRole('button',{name:'Edit customers'}));expect(await screen.findByLabelText('Row 1 email')).toHaveValue('ann@shop.test');
 });
  it('requests dataset pages and sizes and resets search to page one',async()=>{
 const second={...customers,id:4,name:'products'};
 fetchMock.mockImplementation((url:string)=>{
 const params=new URL(url,'http://localhost').searchParams;const page=Number(params.get('page'));
 return reply({items:[{...(page===2?second:customers),rows:undefined,rowCount:2}],total:26,page,pageSize:Number(params.get('pageSize'))});
 });
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TestDataPage /></QueryClientProvider>);
 await screen.findByText('customers');fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByText('products');
 fireEvent.change(screen.getByLabelText('Search by name'),{target:{value:'custom'}});
 await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.includes('page=1')&&url.includes('search=custom'))).toBe(true));
 await screen.findByText('customers');fireEvent.change(screen.getByLabelText('Items per page'),{target:{value:'50'}});
 await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.includes('page=1')&&url.includes('pageSize=50'))).toBe(true));
 });
  it('shows catalog failures instead of an empty-data message', async () => {
    fetchMock.mockImplementation(() => reply({error:'Catalog unavailable'},500));
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TestDataPage /></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
    expect(screen.queryByText(/No shared data yet/)).toBeNull();
  });
  it('lists the sets with the placeholders that read them, and creates one from a table', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return reply({ ...JSON.parse(String(init.body)), id: 4 }, 201);
      return reply({items:[{...customers,rows:undefined,rowCount:2}],total:1,page:1,pageSize:25});
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TestDataPage />
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId('data-set');
    expect(card).toHaveTextContent('customers');
    expect(card).toHaveTextContent('2 row(s) · 2 column(s)');
    expect(card).toHaveTextContent('{{data.customers.email}}');

    fireEvent.click(screen.getAllByText('New data set')[0]);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'cards' } });
    fireEvent.click(screen.getByText('Add column'));
    fireEvent.change(screen.getByLabelText('Column name value'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Row 1 number'), { target: { value: '4111111111111111' } });
    expect(screen.getByTestId('data-set-variables')).toHaveTextContent('{{data.cards.number}}');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ name: 'cards', description: null, columns: ['number'], rows: [{ number: '4111111111111111' }] });
  });
});

describe('DatasetPanel with shared sets', () => {
  it('points the test at a shared set, shows its rows and columns, and copies them on request', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DatasetPanel dataset={[]} onChange={onChange} sharedSets={[customers]} />);
    expect(screen.getByLabelText('Use a shared data set')).toBeTruthy();

    rerender(<DatasetPanel dataset={[{ $sharedSet: '3' }]} onChange={onChange} sharedSets={[customers]} />);
    const shared = screen.getByTestId('dataset-shared');
    expect(shared).toHaveTextContent('2 runs');
    expect(shared).toHaveTextContent('{{email}}');
    fireEvent.click(screen.getByText("Use a copy as this test's own rows"));
    expect(onChange).toHaveBeenCalledWith(customers.rows);
  });

  it('says so when the set it points at no longer exists', () => {
    render(<DatasetPanel dataset={[{ $sharedSet: '99' }]} onChange={() => {}} sharedSets={[customers]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('no longer exists (id 99)');
  });
});
