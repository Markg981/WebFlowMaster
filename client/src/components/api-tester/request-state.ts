import { v4 as uuidv4 } from 'uuid';
import type { ApiPerformance } from '@shared/api-performance';
import type { ProtocolConfig } from '@shared/api-protocol-config';
import type { ApiTest, Assertion, AuthParams, AuthType, Extraction } from '@shared/schema';
import { emptyAuthParamsFor } from './AuthorizationPanel';
import {
  fileToBase64,
  type BodyType,
  type FormDataField,
  type KeyValuePair,
  type MultipartPart,
} from './request-model';

/**
 * The API tester's request, between the page's form and the two places it goes: the proxy
 * that sends it, and the saved test it is loaded from. Kept free of React so both directions
 * can be tested without rendering the page.
 */

export const emptyKeyValueRow = (prefix: 'qp' | 'rh'): KeyValuePair => ({
  id: `${prefix}-${Date.now()}`,
  key: '',
  value: '',
  enabled: true,
});

export const emptyFormDataRow = (): FormDataField => ({
  id: uuidv4(),
  key: '',
  value: '',
  enabled: true,
  type: 'text',
});

export const emptyUrlEncodedRow = (): KeyValuePair => ({
  id: uuidv4(),
  key: '',
  value: '',
  enabled: true,
});

/** JSON columns arrive parsed from the API, but older rows and history entries hold strings. */
function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * Query parameters or headers as saved: a list of rows, or the older `{ key: value }` object.
 * Always at least one row, so the editor has a line to type in.
 */
export function parseKeyValueRows(value: unknown, prefix: 'qp' | 'rh'): KeyValuePair[] {
  if (!value) return [emptyKeyValueRow(prefix)];
  let rows: KeyValuePair[] = [];
  try {
    const parsed = parseJson(value);
    if (Array.isArray(parsed)) {
      rows = parsed.map((p: any, i: number) => ({
        id: p.id || `${prefix}-${Date.now()}-${i}`,
        key: p.key || '',
        value: p.value || '',
        enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
      }));
    } else if (typeof parsed === 'object' && parsed !== null) {
      rows = Object.entries(parsed).map(([k, v], i) => ({
        id: `${prefix}-${Date.now()}-${i}`,
        key: k,
        value: Array.isArray(v) ? v.join(',') : String(v),
        enabled: true,
      }));
    }
  } catch (e) {
    console.error(`Error parsing ${prefix} rows:`, e);
  }
  return rows.length > 0 ? rows : [emptyKeyValueRow(prefix)];
}

/** Everything a saved test sets in the form. */
export type LoadedRequest = {
  method: string;
  url: string;
  queryParams: KeyValuePair[];
  requestHeaders: KeyValuePair[];
  bodyType: BodyType;
  rawBody: string;
  rawContentType: string;
  graphqlQuery: string;
  graphqlVariables: string;
  formData: FormDataField[];
  urlEncoded: KeyValuePair[];
  protoDefinition: string;
  protocolConfig: ProtocolConfig | null;
  assertions: Assertion[];
  extractions: Extraction[];
  performance: ApiPerformance | null;
  authType: AuthType;
  authParams: AuthParams;
  /** Form-data file parts: their bytes are not saved, so the user must pick the files again. */
  hasFileFields: boolean;
};

type SavedTest = ApiTest & {
  protocolConfig?: ProtocolConfig | null;
  protoDefinition?: string | null;
  extractions?: unknown;
  performance?: ApiPerformance | null;
};

function parseList<T>(value: unknown, what: string): T[] {
  if (!value) return [];
  try {
    const parsed = parseJson(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`Error parsing ${what} from saved test:`, e);
    return [];
  }
}

export function requestFromTest(saved: ApiTest): LoadedRequest {
  const test = saved as SavedTest;

  const formDataRows = parseList<any>(test.bodyFormData, 'bodyFormData');
  const formData: FormDataField[] = formDataRows.map((item) => ({
    id: item.id || uuidv4(),
    key: item.key || '',
    // A file's bytes are not stored, only that there was one.
    value: item.type === 'file' ? null : item.value || '',
    enabled: item.enabled !== undefined ? item.enabled : true,
    type: item.type === 'file' ? 'file' : 'text',
  }));

  const urlEncoded: KeyValuePair[] = parseList<any>(test.bodyUrlEncoded, 'bodyUrlEncoded').map(
    (item) => ({
      id: item.id || uuidv4(),
      key: item.key || '',
      value: item.value || '',
      enabled: item.enabled !== undefined ? item.enabled : true,
    }),
  );

  // The scheme and its parameters are set together, always. Setting only the ones the
  // saved test happens to carry left the previous test's credentials in place behind the
  // new test's scheme — and it is the parameters that are sent.
  const authType = (test.authType as AuthType) || 'none';
  let authParams: AuthParams;
  try {
    authParams = (parseJson(test.authParams) as AuthParams | null) ?? emptyAuthParamsFor(authType);
  } catch (e) {
    console.error('Error parsing authParams from saved test:', e);
    authParams = emptyAuthParamsFor(authType);
  }

  return {
    method: test.method,
    url: test.url,
    queryParams: parseKeyValueRows(test.queryParams, 'qp'),
    requestHeaders: parseKeyValueRows(test.requestHeaders, 'rh'),
    bodyType: (test.bodyType as BodyType) || 'raw',
    rawBody: typeof test.requestBody === 'string' ? test.requestBody : '',
    rawContentType: test.bodyRawContentType || 'application/json',
    graphqlQuery: test.bodyGraphqlQuery || '',
    graphqlVariables: test.bodyGraphqlVariables || '',
    formData: formData.length > 0 ? formData : [emptyFormDataRow()],
    urlEncoded: urlEncoded.length > 0 ? urlEncoded : [emptyUrlEncodedRow()],
    protoDefinition: test.protoDefinition || '',
    protocolConfig: test.protocolConfig ?? null,
    assertions: parseList<Assertion>(test.assertions, 'assertions'),
    extractions: parseList<Extraction>(test.extractions, 'extractions'),
    performance: test.performance ?? null,
    authType,
    authParams,
    hasFileFields: formDataRows.some((item) => item.type === 'file'),
  };
}

/** The form's request fields that decide what is sent. */
export type RequestForm = {
  method: string;
  queryParams: KeyValuePair[];
  requestHeaders: KeyValuePair[];
  bodyType: BodyType;
  rawBody: string;
  rawContentType: string;
  binaryFile: File | null;
  graphqlQuery: string;
  graphqlVariables: string;
  formData: FormDataField[];
  urlEncoded: KeyValuePair[];
};

/** A problem with the form that does not stop the request, shown to the user as it is sent. */
export type RequestWarning = 'invalid-json-body' | 'invalid-graphql-variables';

export type BuiltRequest = {
  queryParams: Record<string, string | string[]>;
  headers: Record<string, string>;
  body?: any;
  multipart?: MultipartPart[];
  binary?: { contentType: string; base64: string; fileName: string };
  warnings: RequestWarning[];
};

/**
 * What the proxy receives for the form: enabled rows only, the body for the chosen type and
 * the Content-Type that goes with it.
 *
 * Form-data and files go to the proxy as JSON like everything else, where a FormData or a
 * File would arrive as `{}`: the parts travel described, files as base64. Authentication is
 * not here: the server applies it, so that `{{name}}` in a credential resolves and a run from
 * this page authenticates the way a scheduled one does.
 */
export async function buildRequest(form: RequestForm): Promise<BuiltRequest> {
  const warnings: RequestWarning[] = [];
  const headers: Record<string, string> = {};
  for (const h of form.requestHeaders) {
    if (h.enabled && h.key.trim()) headers[h.key] = h.value;
  }

  // A key repeated in the list is sent as many times as it appears.
  const queryParams: Record<string, string | string[]> = {};
  for (const p of form.queryParams) {
    if (!p.enabled || !p.key.trim()) continue;
    const existing = queryParams[p.key];
    if (existing === undefined) queryParams[p.key] = p.value;
    else if (Array.isArray(existing)) existing.push(p.value);
    else queryParams[p.key] = [existing, p.value];
  }

  // GET and HEAD carry no body, whatever body type the form shows.
  if (form.method === 'GET' || form.method === 'HEAD' || form.bodyType === 'none') {
    delete headers['Content-Type'];
    delete headers['content-type'];
    return { queryParams, headers, warnings };
  }

  let body: any = undefined;
  let contentType: string | undefined = undefined;
  let multipart: MultipartPart[] | undefined = undefined;
  let binary: BuiltRequest['binary'] = undefined;

  switch (form.bodyType) {
    case 'form-data': {
      multipart = [];
      for (const field of form.formData) {
        if (!field.enabled || !field.key) continue;
        if (field.type === 'file' && field.value instanceof File) {
          multipart.push({
            key: field.key,
            type: 'file',
            fileName: field.value.name,
            contentType: field.value.type || 'application/octet-stream',
            base64: await fileToBase64(field.value),
          });
        } else if (field.type === 'text') {
          multipart.push({ key: field.key, type: 'text', value: (field.value as string) ?? '' });
        }
      }
      // The server sets the Content-Type, with the boundary.
      break;
    }
    case 'x-www-form-urlencoded': {
      const params = new URLSearchParams();
      for (const pair of form.urlEncoded) {
        if (pair.enabled && pair.key) params.append(pair.key, pair.value);
      }
      body = params.toString();
      contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
      break;
    }
    case 'raw':
      if (form.rawBody.trim()) {
        body = form.rawBody;
        if (form.rawContentType === 'application/json') {
          try {
            body = JSON.parse(form.rawBody);
          } catch {
            warnings.push('invalid-json-body'); // sent as text
          }
        }
      }
      contentType = form.rawContentType;
      break;
    case 'binary':
      if (form.binaryFile) {
        binary = {
          contentType: form.binaryFile.type || 'application/octet-stream',
          base64: await fileToBase64(form.binaryFile),
          fileName: form.binaryFile.name,
        };
      }
      contentType = form.binaryFile?.type || 'application/octet-stream';
      break;
    case 'GraphQL': {
      const payload: { query: string; variables?: object } = { query: form.graphqlQuery };
      if (form.graphqlVariables.trim()) {
        try {
          payload.variables = JSON.parse(form.graphqlVariables);
        } catch {
          warnings.push('invalid-graphql-variables'); // sent without variables
        }
      }
      body = JSON.stringify(payload);
      contentType = 'application/json';
      break;
    }
  }

  if (contentType) {
    headers['Content-Type'] = contentType;
  } else {
    delete headers['Content-Type'];
    delete headers['content-type'];
  }
  return { queryParams, headers, body, multipart, binary, warnings };
}
