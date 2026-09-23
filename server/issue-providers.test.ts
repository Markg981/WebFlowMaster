import { describe, it, expect, vi } from 'vitest';
import { addComment, authHeader, checkConnection, createIssue, toAdf, toHtml } from './issue-providers';

/**
 * Speaking to Jira and to Azure DevOps.
 *
 * Two systems, two wire formats, one thing that matters in both: when they refuse, the caller
 * has to learn what they said. "Creating the issue failed (400)" sends somebody looking; "400:
 * issuetype: is required" tells them what to fix.
 */

const jira = {
  provider: 'jira' as const,
  baseUrl: 'https://acme.atlassian.net/',
  projectKey: 'SHOP',
  issueType: 'Bug',
  userEmail: 'qa@acme.test',
  token: 'token-123',
};

const azure = {
  provider: 'azure_devops' as const,
  baseUrl: 'https://dev.azure.com/acme',
  projectKey: 'Platform',
  issueType: 'Bug',
  token: 'pat-456',
};

function respond(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('authHeader', () => {
  it('pairs a Jira token with the account it belongs to', () => {
    expect(authHeader(jira)).toBe(`Basic ${Buffer.from('qa@acme.test:token-123').toString('base64')}`);
  });

  it('sends an Azure DevOps token with no username, which is what it wants', () => {
    expect(authHeader(azure)).toBe(`Basic ${Buffer.from(':pat-456').toString('base64')}`);
  });
});

describe('toAdf', () => {
  it('turns lines into the document Jira v3 requires', () => {
    const doc = toAdf('First line\n\nSecond line') as any;

    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content[0].text).toBe('First line');
  });

  it('still produces a document for an empty body', () => {
    // An empty string here would be rejected by Jira, which is a failure to file over nothing.
    expect((toAdf('') as any).content).toHaveLength(1);
  });
});

describe('toHtml', () => {
  it('survives being HTML, which is how Azure DevOps renders it', () => {
    expect(toHtml('<script>alert(1)</script>\nnext')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;<br/>next',
    );
  });
});

describe('createIssue', () => {
  it('files a Jira issue and answers with where to find it', async () => {
    const fetchImpl = respond({ id: '10001', key: 'SHOP-412' });

    const created = await createIssue(jira, { title: 'Checkout fails', body: 'Because.' }, { fetchImpl });

    expect(created).toEqual({ key: 'SHOP-412', url: 'https://acme.atlassian.net/browse/SHOP-412' });
    const [url, init] = fetchImpl.mock.calls[0];
    // The trailing slash on the configured base URL must not become a double slash.
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue');
    expect(JSON.parse(init.body).fields.project.key).toBe('SHOP');
    expect(JSON.parse(init.body).fields.issuetype.name).toBe('Bug');
  });

  it('files an Azure DevOps work item as the patch it expects', async () => {
    const fetchImpl = respond({ id: 77, _links: { html: { href: 'https://dev.azure.com/acme/_workitems/edit/77' } } });

    const created = await createIssue(azure, { title: 'Checkout fails', body: 'Because.' }, { fetchImpl });

    expect(created).toEqual({ key: '77', url: 'https://dev.azure.com/acme/_workitems/edit/77' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/Platform/_apis/wit/workitems/$Bug');
    expect(init.headers['Content-Type']).toBe('application/json-patch+json');
    expect(JSON.parse(init.body)[0]).toEqual({ op: 'add', path: '/fields/System.Title', value: 'Checkout fails' });
  });

  it('repeats what Jira said was wrong, rather than the status code', async () => {
    const fetchImpl = respond({ errors: { issuetype: 'Specify an issue type' } }, { status: 400 });

    await expect(createIssue(jira, { title: 't', body: 'b' }, { fetchImpl })).rejects.toThrow(
      /issuetype: Specify an issue type/,
    );
  });

  it('repeats what Azure DevOps said was wrong', async () => {
    const fetchImpl = respond({ message: 'The field Area Path contains an invalid value' }, { status: 400 });

    await expect(createIssue(azure, { title: 't', body: 'b' }, { fetchImpl })).rejects.toThrow(
      /Area Path/,
    );
  });

  it('refuses to claim an issue exists when the answer does not name one', async () => {
    const fetchImpl = respond({ ok: true });

    await expect(createIssue(jira, { title: 't', body: 'b' }, { fetchImpl })).rejects.toThrow(/did not say/);
  });
});

describe('addComment', () => {
  it('comments on the Jira issue that already has this failure', async () => {
    const fetchImpl = respond({ id: '1' }, { status: 201 });

    await addComment(jira, 'SHOP-412', 'Failed again.', { fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://acme.atlassian.net/rest/api/3/issue/SHOP-412/comment');
  });

  it('comments on the Azure DevOps work item', async () => {
    const fetchImpl = respond({ id: 5 }, { status: 200 });

    await addComment(azure, '77', 'Failed again.', { fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toContain('/_apis/wit/workItems/77/comments');
  });
});

describe('checkConnection', () => {
  it('confirms the project it can see', async () => {
    const fetchImpl = respond({ name: 'Shop' });

    await expect(checkConnection(jira, { fetchImpl })).resolves.toEqual({
      ok: true,
      detail: 'Connected to Shop.',
    });
  });

  it('says the credentials were refused, not that something went wrong', async () => {
    const fetchImpl = respond({}, { status: 401 });

    const result = await checkConnection(jira, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('API token');
  });

  it('says which project could not be found', async () => {
    const fetchImpl = respond({}, { status: 404 });

    const result = await checkConnection(azure, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Platform');
  });

  it('answers rather than throwing when the host cannot be reached', async () => {
    // This is called from a button somebody pressed. An exception here would be a stack trace
    // where an explanation belongs.
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const result = await checkConnection(jira, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('acme.atlassian.net');
  });
});
