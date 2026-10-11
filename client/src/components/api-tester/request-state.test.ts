import { describe, expect, it } from 'vitest';
import type { ApiTest } from '@shared/schema';
import {
  buildRequest,
  emptyFormDataRow,
  emptyUrlEncodedRow,
  parseKeyValueRows,
  requestFromTest,
  type RequestForm,
} from './request-state';

const row = (key: string, value: string, enabled = true) => ({ id: key, key, value, enabled });

const form = (overrides: Partial<RequestForm> = {}): RequestForm => ({
  method: 'POST',
  queryParams: [],
  requestHeaders: [],
  bodyType: 'raw',
  rawBody: '',
  rawContentType: 'application/json',
  binaryFile: null,
  graphqlQuery: '',
  graphqlVariables: '',
  formData: [emptyFormDataRow()],
  urlEncoded: [emptyUrlEncodedRow()],
  ...overrides,
});

const savedTest = (fields: Partial<ApiTest> & Record<string, unknown>) =>
  ({ method: 'POST', url: 'https://api.example.com', ...fields }) as unknown as ApiTest;

describe('parseKeyValueRows', () => {
  it('reads both the list format and the older key/value object', () => {
    expect(parseKeyValueRows([row('a', '1', false)], 'qp')).toEqual([row('a', '1', false)]);
    const fromObject = parseKeyValueRows('{"tag":["x","y"],"n":2}', 'qp');
    expect(fromObject.map(({ key, value }) => [key, value])).toEqual([
      ['tag', 'x,y'],
      ['n', '2'],
    ]);
  });

  it('leaves one empty row when there is nothing, or nothing readable', () => {
    for (const value of [null, '[]', 'not json']) {
      const rows = parseKeyValueRows(value, 'rh');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ key: '', value: '', enabled: true });
    }
  });
});

describe('requestFromTest', () => {
  it('keeps the form-data fields of a test that has no urlencoded body', () => {
    // The loader used to reset the form data whenever bodyUrlEncoded was empty.
    const loaded = requestFromTest(
      savedTest({
        bodyType: 'form-data',
        bodyFormData: [{ id: 'f1', key: 'name', value: 'Ada', enabled: true, type: 'text' }],
        bodyUrlEncoded: null,
      }),
    );

    expect(loaded.bodyType).toBe('form-data');
    expect(loaded.formData).toEqual([
      { id: 'f1', key: 'name', value: 'Ada', enabled: true, type: 'text' },
    ]);
    expect(loaded.urlEncoded).toHaveLength(1);
    expect(loaded.hasFileFields).toBe(false);
  });

  it('flags file parts, whose bytes are not saved', () => {
    const loaded = requestFromTest(
      savedTest({ bodyFormData: '[{"key":"doc","type":"file","fileName":"a.pdf"}]' }),
    );
    expect(loaded.formData[0]).toMatchObject({ key: 'doc', type: 'file', value: null });
    expect(loaded.hasFileFields).toBe(true);
  });

  it('sets the auth scheme and its parameters together', () => {
    expect(requestFromTest(savedTest({ authType: 'bearer', authParams: null }))).toMatchObject({
      authType: 'bearer',
      authParams: expect.objectContaining({}),
    });
    expect(requestFromTest(savedTest({})).authType).toBe('none');
  });

  it('falls back to defaults for a test that saved little', () => {
    const loaded = requestFromTest(savedTest({ assertions: 'broken' }));
    expect(loaded).toMatchObject({
      bodyType: 'raw',
      rawContentType: 'application/json',
      assertions: [],
      extractions: [],
      protocolConfig: null,
    });
  });
});

describe('buildRequest', () => {
  it('sends enabled rows only, and a repeated query key as a list', async () => {
    const built = await buildRequest(
      form({
        method: 'GET',
        queryParams: [row('tag', 'a'), row('tag', 'b'), row('off', 'x', false)],
        requestHeaders: [row('X-Trace', '1'), row('Content-Type', 'text/plain')],
      }),
    );

    expect(built.queryParams).toEqual({ tag: ['a', 'b'] });
    // GET carries no body, so no Content-Type either.
    expect(built.headers).toEqual({ 'X-Trace': '1' });
    expect(built.body).toBeUndefined();
  });

  it('parses a JSON body, and sends an invalid one as text with a warning', async () => {
    expect((await buildRequest(form({ rawBody: '{"a":1}' }))).body).toEqual({ a: 1 });

    const invalid = await buildRequest(form({ rawBody: '{oops' }));
    expect(invalid.body).toBe('{oops');
    expect(invalid.headers['Content-Type']).toBe('application/json');
    expect(invalid.warnings).toEqual(['invalid-json-body']);
  });

  it('encodes urlencoded pairs and sets their Content-Type', async () => {
    const built = await buildRequest(
      form({
        bodyType: 'x-www-form-urlencoded',
        urlEncoded: [row('q', 'a b'), row('skip', 'x', false)],
      }),
    );
    expect(built.body).toBe('q=a+b');
    expect(built.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('describes form-data parts and leaves the Content-Type to the server', async () => {
    const built = await buildRequest(
      form({
        bodyType: 'form-data',
        requestHeaders: [row('Content-Type', 'application/json')],
        formData: [
          { id: '1', key: 'name', value: 'Ada', enabled: true, type: 'text' },
          { id: '2', key: 'doc', value: new File(['hi'], 'a.txt'), enabled: true, type: 'file' },
        ],
      }),
    );

    expect(built.multipart).toEqual([
      { key: 'name', type: 'text', value: 'Ada' },
      {
        key: 'doc',
        type: 'file',
        fileName: 'a.txt',
        contentType: 'application/octet-stream',
        base64: 'aGk=',
      },
    ]);
    expect(built.headers).toEqual({});
  });

  it('sends a GraphQL query without variables that are not JSON', async () => {
    const built = await buildRequest(
      form({ bodyType: 'GraphQL', graphqlQuery: '{ me { id } }', graphqlVariables: '{nope' }),
    );
    expect(JSON.parse(built.body)).toEqual({ query: '{ me { id } }' });
    expect(built.warnings).toEqual(['invalid-graphql-variables']);
  });
});
