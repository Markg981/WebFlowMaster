import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestLibraryPage from './TestLibraryPage';

// The history dialog asks who is looking, to offer publishing actions to editors only.
let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

/**
 * Every test this organization has, in one place — because there was no such place.
 *
 * A test was created in the builder and selected into a plan, and between those two moments it
 * was unreachable: nothing listed what existed, nothing said what a test was for, nothing could
 * show what it used to be.
 */

const fetchMock = vi.fn();

const smoke = { id: 'tag-1', name: 'smoke', uiCount: 2, apiCount: 0 };
const slow = { id: 'tag-2', name: 'slow', uiCount: 1, apiCount: 0 };

const tests = [
  {
    id: 1,
    name: 'Checkout',
    url: 'https://shop.test/checkout',
    status: 'draft', kind: 'browser',
    updatedAt: '2026-09-20T10:00:00.000Z',
    tags: [smoke],
  },
  {
    id: 2,
    name: 'Login',
    url: 'https://shop.test/login',
    status: 'draft', kind: 'browser',
    updatedAt: '2026-09-19T10:00:00.000Z',
    tags: [smoke, slow],
  },
];

function catalog(items: unknown[], total = items.length, page = 1) {
 return {ok:true,json:async()=>({items,total,page,pageSize:25})};
}
function respond(url: string) {
 if (url.includes('/api/tags')) return {ok:true,json:async()=>[smoke,slow]};
 if (url.startsWith('/api/catalog/tests')) {
  const params=new URL(url,'http://localhost').searchParams;
  const tags=(params.get('tagIds')||'').split(',').filter(Boolean);
  return catalog(tests.filter(test=>test.name.toLowerCase().includes((params.get('search')||'').toLowerCase()) && tags.every(id=>test.tags.some(tag=>tag.id===id))));
 }
 return {ok:true,json:async()=>[]};
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  render(
    <QueryClientProvider client={client}>
      <TestLibraryPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'editor';
  toast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve(respond(String(url))));
  vi.stubGlobal('fetch', fetchMock);
});

describe('TestLibraryPage', () => {
 it('opens the source editor for BDD and offers no browser export or independent step editor',async()=>{
 const bddTest={...tests[0],bdd:{language:'en',source:'Feature: F\nScenario: S\nGiven a',uri:'f.feature',scenarioLine:2,mode:'cucumber',binding:{id:'00000000-0000-4000-8000-000000000001',revision:'r1'}},sequence:[{action:{id:'manualStep'},value:'Given a'}]};
 fetchMock.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/catalog/tests')?catalog([{...tests[0],kind:'cucumber'}]):url==='/api/tests/1'?{ok:true,json:async()=>bddTest}:url==='/api/bdd/profiles'?{ok:true,json:async()=>({profiles:[]})}:respond(url)));
 renderPage();await screen.findByText('Checkout');expect(screen.getByText('Cucumber')).toBeInTheDocument();expect(screen.queryByText('Manual')).toBeNull();expect(screen.queryByTitle('Edit steps')).toBeNull();expect(screen.queryByTitle('Download as a Playwright test')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Edit Gherkin'}));expect(await screen.findByLabelText('Gherkin source')).toHaveValue(bddTest.bdd.source);
 });
  it('requests the next server page and resets to page one on search', async()=>{
 fetchMock.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/catalog/tests')?catalog([tests[new URL(url,'http://localhost').searchParams.get('page')==='2'?1:0]],26,Number(new URL(url,'http://localhost').searchParams.get('page'))):respond(url)));
 renderPage(); await screen.findByText('Checkout');
 expect(fetchMock.mock.calls.some(([url])=>url==='/api/tests/1')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Next'})); await screen.findByText('Login');
 expect(fetchMock.mock.calls.some(([url,options])=>url.includes('page=2') && options.signal instanceof AbortSignal)).toBe(true);
 fireEvent.change(screen.getByLabelText('Search by name'),{target:{value:'check'}});
 await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.includes('page=1')&&url.includes('search=check'))).toBe(true));
 });
 it('does not open an empty manual editor when details fail',async()=>{
 fetchMock.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/catalog/tests')?catalog([{...tests[0],kind:'manual'}]):url==='/api/tests/1'?{ok:false,json:async()=>({})}:respond(url)));
 renderPage();await screen.findByText('Checkout');fireEvent.click(screen.getByTitle('Edit steps'));
 await waitFor(()=>expect(toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'})));
 expect(screen.queryByRole('dialog')).toBeNull();
 });
  it('returns to the last valid page after deleting its final item',async()=>{
 let deleted=false;
 vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));
 fetchMock.mockImplementation((url:string,init?:RequestInit)=>{
  if(init?.method==='DELETE'){deleted=true;return Promise.resolve({ok:true,status:204});}
  if(!url.startsWith('/api/catalog/tests'))return Promise.resolve(respond(url));
  const page=Number(new URL(url,'http://localhost').searchParams.get('page'));
  return Promise.resolve(catalog(deleted&&page===2?[]:[tests[page===2?1:0]],deleted?25:26,page));
 });
 renderPage();await screen.findByText('Checkout');fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByText('Login');
 fireEvent.click(screen.getByTitle('Delete'));
 // Page one comes back from the cache first (26 items, two pages); wait for its refetch.
 expect(await screen.findByText('25 items · Page 1 of 1')).toBeInTheDocument();
 expect(screen.getByText('Checkout')).toBeInTheDocument();
 });
 it('opens legacy manual steps stored as encoded JSON only after loading details',async()=>{
 fetchMock.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/catalog/tests')?catalog([{...tests[0],kind:'manual'}]):url==='/api/tests/1'?{ok:true,json:async()=>({...tests[0],sequence:JSON.stringify([{action:{id:'manualStep'},value:'Legacy label'}])})}:respond(url)));
 renderPage();await screen.findByText('Checkout');fireEvent.click(screen.getByTitle('Edit steps'));
 expect(await screen.findByRole('dialog')).toHaveTextContent('Legacy label');
 });
 it('fetches manual steps on edit from a catalog without sequence',async()=>{
 fetchMock.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/catalog/tests')?catalog([{...tests[0],kind:'manual'}]):url==='/api/tests/1'?{ok:true,json:async()=>({...tests[0],sequence:[{action:{id:'manualStep'},value:'Inspect label'}]})}:respond(url)));
 renderPage();await screen.findByText('Checkout');expect(fetchMock.mock.calls.some(([url])=>url==='/api/tests/1')).toBe(false);
 fireEvent.click(screen.getByTitle('Edit steps'));expect(await screen.findByRole('dialog')).toHaveTextContent('Inspect label');
 });
  it('cancels an outstanding catalog request when a tag filter changes', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!url.startsWith('/api/catalog/tests')) return Promise.resolve(respond(url));
      if (!new URL(url, 'http://localhost').searchParams.get('tagIds')) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => firstSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      }
      return Promise.resolve(catalog([tests[1]]));
    });
    renderPage();
    const filters = within(await screen.findByTestId('tag-filters'));
    fireEvent.click(await filters.findByText(/^slow/));
    await screen.findByText('Login');
    expect(firstSignal?.aborted).toBe(true);
  });
  it('lists the saved tests with what each one is for', async () => {
    renderPage();

    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(await screen.findByText('Login')).toBeInTheDocument();
    // The tag is on both rows, which is the point of it.
    expect(screen.getAllByText('smoke').length).toBeGreaterThanOrEqual(2);
  });

  it('narrows by name', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'log' } });

    await waitFor(()=>expect(screen.queryByText('Checkout')).not.toBeInTheDocument());
    expect(await screen.findByText('Login')).toBeInTheDocument();
  });

  it('narrows by every selected tag, not by any of them', async () => {
    // Adding a second filter asks for a shorter list. An OR would hand back a longer one.
    renderPage();
    await screen.findByText('Checkout');

    const filters = within(screen.getByTestId('tag-filters'));
    fireEvent.click(filters.getByText(/^smoke/));
    fireEvent.click(filters.getByText(/^slow/));

    expect(await screen.findByText('Login')).toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByText('Checkout')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url])=>new URL(url,'http://localhost').searchParams.get('tagIds')==='tag-1,tag-2')).toBe(true);
  });

  it('says a filter matched nothing, rather than looking empty', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'nothing like this' } });

    expect(await screen.findByText('No test matches this filter.')).toBeInTheDocument();
  });

  it('sends the whole set of tags a test should carry', async () => {
    renderPage();
    await screen.findByText('Checkout');

    // The first row's picker: open it and add "slow" to a test that only has "smoke".
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tags' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /^slow$/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/tests/1/tags');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body).tagIds).toEqual(['tag-1', 'tag-2']);
    });
  });

  it('opens the history of the test that was asked for', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.click(screen.getAllByTitle('History')[0]);

    expect(await screen.findByText(/History of "Checkout"/)).toBeInTheDocument();
  });

  it('asks before deleting a test and its history', async () => {
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmMock);
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    expect(confirmMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('gives a viewer the list and the history, and nothing that changes a test', async () => {
    role = 'viewer';
    renderPage();
    await screen.findByText('Checkout');

    expect(screen.getAllByText('smoke').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTitle('History').length).toBe(2);
    expect(screen.queryByText('New manual test')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit tags' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('reports a failed load instead of an empty library', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tags')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    renderPage();

    expect(await screen.findByText('Could not load the catalog.')).toBeInTheDocument();
  });
});
