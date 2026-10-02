import { randomUUID } from 'node:crypto';
import { fromWsdl, looksLikeWsdl } from './wsdl-import';
import { parse as parseYaml } from 'yaml';
import type { Assertion, AuthParams } from '@shared/schema';

/**
 * API tests from what a team already has: an OpenAPI 3 or Swagger 2 description (JSON or YAML),
 * or a Postman collection (v2.0, v2.1). Nothing here touches the database — the route previews the
 * result and saves what the person keeps.
 *
 * Each operation or request becomes one test, ready to run against an environment:
 * - the address starts with {{baseUrl}} (OpenAPI) or keeps Postman's own {{variables}}, which are
 *   the same syntax; path parameters become {{name}};
 * - required query and header parameters are filled with their example, or with {{name}};
 * - the body is the operation's example, or one made from its schema (JSON and form bodies);
 * - security becomes the test's authentication, with the secret as a variable ({{token}}…), never a
 *   value: an imported file is not where credentials should come from;
 * - the expected status becomes an assertion (OpenAPI's first 2xx response; Postman's
 *   `pm.response.to.have.status(…)`).
 *
 * What it cannot carry over is said, per test, in the warnings: multipart bodies, Postman scripts
 * beyond the status check, OAuth flows.
 */

export type ImportFormat = 'openapi' | 'swagger' | 'postman' | 'wsdl';

export interface ImportedApiTest {
  name: string;
  method: string;
  url: string;
  queryParams: Record<string, string> | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | null;
  bodyType: 'none' | 'raw' | 'GraphQL';
  bodyRawContentType: string | null;
  bodyGraphqlQuery: string | null;
  bodyGraphqlVariables: string | null;
  authType: string | null;
  authParams: AuthParams | null;
  assertions: Assertion[];
  /** The tag (OpenAPI) or folder (Postman) it came from. */
  module: string | null;
  /** Where in the file it came from: `GET /orders/{id}`, or the Postman folder path. */
  source: string;
  warnings: string[];
}

export interface ImportVariable {
  name: string;
  /** A suggestion read from the file (a server URL, a collection variable); never a secret. */
  value: string | null;
  why: string;
}

export interface ImportResult {
  format: ImportFormat;
  title: string;
  tests: ImportedApiTest[];
  /** What an environment needs for the tests to run. */
  variables: ImportVariable[];
  warnings: string[];
}

export class ImportError extends Error {}

/** The most tests one import makes: a description bigger than this is better imported by tag. */
export const MAX_IMPORTED_TESTS = 500;
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

type Json = Record<string, any>;

/** Reads the file: JSON or YAML, then which of the three it is. */
export function importApiDescription(content: string): ImportResult {
  let doc: unknown;
  const text = content.trim();
  if (!text) throw new ImportError('The file is empty.');
  // A SOAP service's WSDL (server/wsdl-import.ts).
  if (text.startsWith('<')) {
    if (looksLikeWsdl(text)) return fromWsdl(text);
    throw new ImportError('An XML file, but not a WSDL 1.1 document.');
  }
  try {
    doc = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 100 });
  } catch (error) {
    throw new ImportError(`Not JSON or YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ImportError('Not an API description: expected an object at the top.');
  const root = doc as Json;
  if (typeof root.openapi === 'string' && root.openapi.startsWith('3')) return fromOpenApi(root, 'openapi');
  if (String(root.swagger) === '2.0') return fromOpenApi(root, 'swagger');
  if (Array.isArray(root.item) && (root.info?.schema?.includes?.('postman') || root.info?._postman_id || root.info?.name)) return fromPostman(root);
  throw new ImportError('Neither OpenAPI 3, Swagger 2, a Postman collection (v2.0 or v2.1) nor a WSDL.');
}

const variableName = (value: string) => value.replace(/[^\w.]/g, '_').replace(/^_+|_+$/g, '') || 'value';
const placeholder = (name: string) => `{{${variableName(name)}}}`;
const statusAssertion = (status: number): Assertion => ({
  id: randomUUID(),
  source: 'status_code',
  comparison: 'equals',
  targetValue: String(status),
  enabled: true,
});

// ─── OpenAPI 3 and Swagger 2 ────────────────────────────────────────────────────

/** Follows a local `$ref` (`#/components/schemas/Order`, `#/definitions/Order`); null for anything else. */
function deref(root: Json, value: any, seen = new Set<string>()): any {
  if (!value || typeof value !== 'object' || typeof value.$ref !== 'string') return value;
  const ref: string = value.$ref;
  if (!ref.startsWith('#/') || seen.has(ref)) return null;
  seen.add(ref);
  const target = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<any>((node, key) => (node && typeof node === 'object' ? node[key] : undefined), root);
  return deref(root, target, seen);
}

/** A value shaped like the schema, from its examples, defaults and types. Depth-limited: schemas can be recursive. */
export function exampleOf(root: Json, schemaIn: any, depth = 0): unknown {
  const schema = deref(root, schemaIn);
  if (!schema || typeof schema !== 'object' || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
    if (!Array.isArray(schema[combinator]) || schema[combinator].length === 0) continue;
    if (combinator !== 'allOf') return exampleOf(root, schema[combinator][0], depth + 1);
    const merged: Json = {};
    for (const part of schema.allOf) {
      const value = exampleOf(root, part, depth + 1);
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged, value);
    }
    return merged;
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
  if (type === 'object' || (!type && schema.properties)) {
    const out: Json = {};
    for (const [key, property] of Object.entries<any>(schema.properties ?? {})) {
      const resolved = deref(root, property);
      if (resolved?.readOnly) continue;
      out[key] = exampleOf(root, property, depth + 1);
    }
    return out;
  }
  if (type === 'array') return [exampleOf(root, schema.items, depth + 1)].filter((v) => v !== null);
  if (type === 'integer' || type === 'number') return typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (type === 'boolean') return true;
  if (type === 'string') {
    switch (schema.format) {
      case 'date-time': return '2026-01-01T00:00:00Z';
      case 'date': return '2026-01-01';
      case 'email': return 'user@example.com';
      case 'uuid': return '00000000-0000-0000-0000-000000000000';
      case 'uri': case 'url': return 'https://example.com';
      default: return 'string';
    }
  }
  return null;
}

/** The base address the file names, as a suggestion for {{baseUrl}}. */
function baseUrlOf(root: Json, format: ImportFormat): string | null {
  if (format === 'swagger') {
    if (!root.host) return null;
    const scheme = Array.isArray(root.schemes) && root.schemes.includes('https') ? 'https' : root.schemes?.[0] ?? 'https';
    return `${scheme}://${root.host}${root.basePath && root.basePath !== '/' ? root.basePath : ''}`;
  }
  const server = Array.isArray(root.servers) ? root.servers[0] : null;
  if (!server?.url) return null;
  // Server variables take their default: https://{region}.api.example.com
  return String(server.url)
    .replace(/\{(\w+)\}/g, (_m: string, name: string) => String(server.variables?.[name]?.default ?? name))
    .replace(/\/+$/, '');
}

/** The parameter's example, default or first allowed value; {{name}} when the file gives none. */
function paramValue(root: Json, param: Json): string {
  const schema = deref(root, param.schema ?? param) ?? {};
  const example =
    param.example ??
    (param.examples ? Object.values<any>(param.examples)[0]?.value : undefined) ??
    schema.example ??
    schema.default ??
    (Array.isArray(schema.enum) ? schema.enum[0] : undefined);
  return example !== undefined && example !== null && typeof example !== 'object' ? String(example) : placeholder(param.name);
}

function authFromScheme(name: string, scheme: Json | null, warnings: string[]): { authType: string; authParams: AuthParams; variables: ImportVariable[] } | null {
  if (!scheme) return null;
  const type = String(scheme.type ?? '').toLowerCase();
  const httpScheme = String(scheme.scheme ?? '').toLowerCase();
  if ((type === 'http' && httpScheme === 'bearer') || type === 'oauth2' || type === 'openidconnect') {
    if (type !== 'http') warnings.push(`${name} is ${scheme.type}: the test sends {{token}} as a bearer token; get one with the OAuth 2.0 authentication or a precondition.`);
    return { authType: 'bearer', authParams: { type: 'bearer', params: { token: '{{token}}' } }, variables: [{ name: 'token', value: null, why: `bearer token (${name})` }] };
  }
  if ((type === 'http' && httpScheme === 'basic') || type === 'basic') {
    return {
      authType: 'basic',
      authParams: { type: 'basic', params: { username: '{{username}}', password: '{{password}}' } },
      variables: [{ name: 'username', value: null, why: `basic authentication (${name})` }, { name: 'password', value: null, why: `basic authentication (${name}): a secret` }],
    };
  }
  if (type === 'apikey' && (scheme.in === 'header' || scheme.in === 'query')) {
    const variable = variableName(name);
    return {
      authType: 'apiKey',
      authParams: { type: 'apiKey', params: { key: String(scheme.name), value: `{{${variable}}}`, addTo: scheme.in } },
      variables: [{ name: variable, value: null, why: `API key sent as ${scheme.in} ${scheme.name}: a secret` }],
    };
  }
  warnings.push(`Security scheme ${name} (${scheme.type}) is not carried over: set the authentication by hand.`);
  return null;
}

function fromOpenApi(root: Json, format: 'openapi' | 'swagger'): ImportResult {
  const tests: ImportedApiTest[] = [];
  const variables = new Map<string, ImportVariable>();
  const warnings: string[] = [];
  const addVariable = (v: ImportVariable) => {
    if (!variables.has(v.name)) variables.set(v.name, v);
  };
  const base = baseUrlOf(root, format);
  addVariable(
    base && /^https?:\/\//i.test(base)
      ? { name: 'baseUrl', value: base, why: 'the address every request starts with' }
      : { name: 'baseUrl', value: null, why: `the address every request starts with${base ? ` (the description names only ${base}: put the host in front)` : ''}` },
  );
  const schemes: Json = format === 'swagger' ? root.securityDefinitions ?? {} : root.components?.securitySchemes ?? {};
  const consumes: string[] = root.consumes ?? [];

  for (const [path, itemIn] of Object.entries<any>(root.paths ?? {})) {
    const item = deref(root, itemIn) ?? {};
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      if (tests.length >= MAX_IMPORTED_TESTS) {
        warnings.push(`Only the first ${MAX_IMPORTED_TESTS} operations were imported.`);
        break;
      }
      const opWarnings: string[] = [];
      const params: Json[] = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(root, p)).filter(Boolean);
      // An operation's own parameter replaces the path's of the same name and place.
      const byKey = new Map<string, Json>();
      for (const p of params) byKey.set(`${p.in}:${p.name}`, p);

      let url = `{{baseUrl}}${path.startsWith('/') ? path : `/${path}`}`;
      const query: Record<string, string> = {};
      const headers: Record<string, string> = {};
      let body: string | null = null;
      let contentType: string | null = null;

      for (const p of byKey.values()) {
        if (p.in === 'path') {
          const value = paramValue(root, p);
          url = url.replace(`{${p.name}}`, value);
          if (value.startsWith('{{')) addVariable({ name: variableName(p.name), value: null, why: `path parameter of ${method.toUpperCase()} ${path}` });
        } else if (p.in === 'query' && p.required) {
          query[p.name] = paramValue(root, p);
          if (query[p.name].startsWith('{{')) addVariable({ name: variableName(p.name), value: null, why: `query parameter of ${method.toUpperCase()} ${path}` });
        } else if (p.in === 'header' && p.required && !/^(authorization|content-type|accept)$/i.test(p.name)) {
          headers[p.name] = paramValue(root, p);
          if (headers[p.name].startsWith('{{')) addVariable({ name: variableName(p.name), value: null, why: `header of ${method.toUpperCase()} ${path}` });
        } else if (p.in === 'body') {
          body = JSON.stringify(exampleOf(root, p.schema) ?? {}, null, 2);
          contentType = 'application/json';
        } else if (p.in === 'formData' && p.required) {
          if (p.type === 'file') opWarnings.push(`The file field "${p.name}" is not carried over.`);
          else query[`__form__${p.name}`] = paramValue(root, p);
        }
      }
      // Swagger 2 form fields, gathered above, become a urlencoded body.
      const formFields = Object.entries(query).filter(([k]) => k.startsWith('__form__'));
      if (formFields.length > 0) {
        for (const [k] of formFields) delete query[k];
        body = new URLSearchParams(formFields.map(([k, v]) => [k.slice(8), v])).toString();
        contentType = 'application/x-www-form-urlencoded';
      }

      if (format === 'openapi' && op.requestBody) {
        const requestBody = deref(root, op.requestBody) ?? {};
        const content: Json = requestBody.content ?? {};
        const json = Object.keys(content).find((t) => /json/i.test(t));
        const form = Object.keys(content).find((t) => /x-www-form-urlencoded/i.test(t));
        const chosen = json ?? form;
        if (chosen) {
          const media = content[chosen] ?? {};
          const example = media.example ?? (media.examples ? deref(root, Object.values<any>(media.examples)[0])?.value : undefined) ?? exampleOf(root, media.schema);
          if (chosen === json) body = JSON.stringify(example ?? {}, null, 2);
          else body = new URLSearchParams(Object.entries((example ?? {}) as Json).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString();
          contentType = chosen === json ? 'application/json' : 'application/x-www-form-urlencoded';
        } else if (Object.keys(content).length > 0) {
          opWarnings.push(`The body (${Object.keys(content).join(', ')}) is not carried over: write it by hand.`);
        }
      } else if (format === 'swagger' && body !== null && contentType === 'application/json' && consumes.length > 0 && !consumes.some((c) => /json/i.test(c))) {
        opWarnings.push(`The operation consumes ${consumes.join(', ')}: check the body.`);
      }
      if (contentType) headers['Content-Type'] = contentType;

      const requirement = (op.security ?? root.security ?? [])[0];
      let auth: ReturnType<typeof authFromScheme> = null;
      if (requirement && typeof requirement === 'object') {
        const schemeName = Object.keys(requirement)[0];
        if (schemeName) auth = authFromScheme(schemeName, deref(root, schemes[schemeName]), opWarnings);
        for (const v of auth?.variables ?? []) addVariable(v);
      }

      const responses = Object.keys(op.responses ?? {});
      const success = responses.map(Number).filter((n) => n >= 200 && n < 300).sort((a, b) => a - b)[0];
      tests.push({
        name: String(op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`).slice(0, 200),
        method: method.toUpperCase(),
        url,
        queryParams: Object.keys(query).length ? query : null,
        requestHeaders: Object.keys(headers).length ? headers : null,
        requestBody: body,
        bodyType: body === null ? 'none' : 'raw',
        bodyRawContentType: contentType,
        bodyGraphqlQuery: null,
        bodyGraphqlVariables: null,
        authType: auth?.authType ?? null,
        authParams: auth?.authParams ?? null,
        assertions: [statusAssertion(success ?? 200)],
        module: Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]).slice(0, 200) : null,
        source: `${method.toUpperCase()} ${path}`,
        warnings: opWarnings,
      });
    }
  }
  if (tests.length === 0) warnings.push('The description has no operations under paths.');
  return { format, title: String(root.info?.title ?? 'API'), tests, variables: [...variables.values()], warnings };
}

// ─── Postman ────────────────────────────────────────────────────────────────────

function postmanUrl(url: any): { url: string; query: Record<string, string> | null } {
  if (typeof url === 'string') return { url, query: null };
  if (!url || typeof url !== 'object') return { url: '', query: null };
  const query: Record<string, string> = {};
  for (const q of url.query ?? []) if (q && !q.disabled && q.key) query[q.key] = q.value ?? '';
  // The raw address minus its query, which travels as parameters instead.
  let raw = String(url.raw ?? '').split('?')[0];
  if (!raw) {
    const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? '';
    const path = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
    raw = `${url.protocol ? `${url.protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  }
  // Postman's :id path variables become {{id}}.
  raw = raw.replace(/\/:(\w+)/g, (_m: string, name: string) => `/{{${name}}}`);
  return { url: raw, query: Object.keys(query).length ? query : null };
}

function postmanAuth(auth: any, warnings: string[]): { authType: string; authParams: AuthParams } | null {
  if (!auth || typeof auth !== 'object' || auth.type === 'noauth') return null;
  const field = (key: string) => {
    const list = auth[auth.type];
    if (Array.isArray(list)) return list.find((e: any) => e?.key === key)?.value;
    return list?.[key];
  };
  const asText = (v: unknown, fallback: string) => (typeof v === 'string' && v !== '' ? v : fallback);
  switch (auth.type) {
    case 'bearer':
      return { authType: 'bearer', authParams: { type: 'bearer', params: { token: asText(field('token'), '{{token}}') } } };
    case 'basic':
      return { authType: 'basic', authParams: { type: 'basic', params: { username: asText(field('username'), '{{username}}'), password: asText(field('password'), '{{password}}') } } };
    case 'apikey':
      return {
        authType: 'apiKey',
        authParams: { type: 'apiKey', params: { key: asText(field('key'), 'X-API-Key'), value: asText(field('value'), '{{apiKey}}'), addTo: field('in') === 'query' ? 'query' : 'header' } },
      };
    default:
      warnings.push(`Postman authentication "${auth.type}" is not carried over: set it by hand.`);
      return null;
  }
}

/** A literal secret in a collection is not imported: it is replaced by a variable and named. */
function withoutLiteralSecret(auth: { authType: string; authParams: AuthParams } | null, variables: Map<string, ImportVariable>) {
  if (!auth) return auth;
  const params = (auth.authParams as { params?: Record<string, string> }).params ?? {};
  const secretKeys = auth.authType === 'bearer' ? ['token'] : auth.authType === 'basic' ? ['password'] : auth.authType === 'apiKey' ? ['value'] : [];
  for (const key of secretKeys) {
    const value = params[key];
    if (typeof value === 'string' && value !== '' && !/^\{\{.*\}\}$/.test(value)) {
      const name = auth.authType === 'apiKey' ? 'apiKey' : auth.authType === 'basic' ? 'password' : 'token';
      params[key] = `{{${name}}}`;
      if (!variables.has(name)) variables.set(name, { name, value: null, why: 'the collection held a literal secret here; it was not imported' });
    }
  }
  return auth;
}

function fromPostman(root: Json): ImportResult {
  const tests: ImportedApiTest[] = [];
  const warnings: string[] = [];
  const variables = new Map<string, ImportVariable>();
  for (const v of root.variable ?? []) {
    if (!v?.key) continue;
    const secret = /token|secret|password|key/i.test(v.key);
    variables.set(v.key, { name: v.key, value: secret ? null : v.value != null ? String(v.value) : null, why: secret ? 'collection variable (a secret: its value was not imported)' : 'collection variable' });
  }

  const walk = (items: any[], folders: string[], inheritedAuth: any) => {
    for (const item of items ?? []) {
      if (tests.length >= MAX_IMPORTED_TESTS) {
        warnings.push(`Only the first ${MAX_IMPORTED_TESTS} requests were imported.`);
        return;
      }
      if (Array.isArray(item?.item)) {
        walk(item.item, [...folders, String(item.name ?? 'Folder')], item.auth ?? inheritedAuth);
        continue;
      }
      const request = typeof item?.request === 'string' ? { url: item.request, method: 'GET' } : item?.request;
      if (!request) continue;
      const itemWarnings: string[] = [];
      const { url, query } = postmanUrl(request.url);
      const headers: Record<string, string> = {};
      for (const h of request.header ?? []) if (h && !h.disabled && h.key) headers[h.key] = h.value ?? '';

      let body: string | null = null;
      let bodyType: ImportedApiTest['bodyType'] = 'none';
      let contentType: string | null = null;
      let graphqlQuery: string | null = null;
      let graphqlVariables: string | null = null;
      const b = request.body;
      if (b && !b.disabled) {
        if (b.mode === 'raw' && typeof b.raw === 'string' && b.raw !== '') {
          body = b.raw;
          bodyType = 'raw';
          contentType = b.options?.raw?.language === 'json' || /^\s*[[{]/.test(b.raw) ? 'application/json' : 'text/plain';
        } else if (b.mode === 'urlencoded') {
          body = new URLSearchParams((b.urlencoded ?? []).filter((e: any) => !e.disabled && e.key).map((e: any) => [e.key, e.value ?? ''])).toString();
          bodyType = 'raw';
          contentType = 'application/x-www-form-urlencoded';
        } else if (b.mode === 'graphql' && b.graphql) {
          graphqlQuery = String(b.graphql.query ?? '');
          graphqlVariables = typeof b.graphql.variables === 'string' ? b.graphql.variables : JSON.stringify(b.graphql.variables ?? {});
          let parsedVariables: unknown = {};
          try {
            parsedVariables = graphqlVariables ? JSON.parse(graphqlVariables) : {};
          } catch {
            itemWarnings.push('Its GraphQL variables are not valid JSON: check them.');
          }
          body = JSON.stringify({ query: graphqlQuery, variables: parsedVariables });
          bodyType = 'GraphQL';
          contentType = 'application/json';
        } else if (b.mode === 'formdata' || b.mode === 'file') {
          itemWarnings.push(`The ${b.mode} body is not carried over: write it by hand.`);
        }
      }
      if (contentType && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = contentType;

      const auth = withoutLiteralSecret(postmanAuth(request.auth ?? inheritedAuth, itemWarnings), variables);

      // pm.response.to.have.status(201) — the one script line that has an equivalent here.
      const scripts = (item.event ?? []).filter((e: any) => e?.listen === 'test').flatMap((e: any) => (Array.isArray(e.script?.exec) ? e.script.exec : [e.script?.exec ?? '']));
      const statusCheck = /to\.have\.status\((\d{3})\)/.exec(scripts.join('\n'));
      const otherScript = scripts.some((line: string) => line.trim() !== '' && !/to\.have\.status\(\d{3}\)|^\s*(pm\.test\(|\}\);?|\/\/)/.test(line));
      if (otherScript) itemWarnings.push('Its test script is not carried over beyond the status check: add assertions by hand.');
      if ((item.event ?? []).some((e: any) => e?.listen === 'prerequest' && (e.script?.exec ?? []).some((l: string) => l.trim()))) {
        itemWarnings.push('Its pre-request script is not carried over: use a precondition or a variable.');
      }

      tests.push({
        name: String(item.name ?? `${request.method ?? 'GET'} ${url}`).slice(0, 200),
        method: String(request.method ?? 'GET').toUpperCase(),
        url,
        queryParams: query,
        requestHeaders: Object.keys(headers).length ? headers : null,
        requestBody: body,
        bodyType,
        bodyRawContentType: bodyType === 'raw' ? contentType : null,
        bodyGraphqlQuery: graphqlQuery,
        bodyGraphqlVariables: graphqlVariables,
        authType: auth?.authType ?? null,
        authParams: auth?.authParams ?? null,
        assertions: [statusAssertion(statusCheck ? Number(statusCheck[1]) : 200)],
        module: folders.length ? folders.join(' / ').slice(0, 200) : null,
        source: [...folders, String(item.name ?? '')].join(' / '),
        warnings: itemWarnings,
      });
    }
  };
  walk(root.item, [], root.auth ?? null);

  // Every {{variable}} the requests use, so the environment can be completed before the first run.
  const used = new Set<string>();
  for (const t of tests) {
    for (const text of [t.url, t.requestBody ?? '', ...Object.values(t.requestHeaders ?? {}), ...Object.values(t.queryParams ?? {})]) {
      for (const m of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) if (!m[1].startsWith('$')) used.add(m[1]);
    }
  }
  for (const name of used) if (!variables.has(name)) variables.set(name, { name, value: null, why: 'used by the requests' });
  if (tests.length === 0) warnings.push('The collection has no requests.');
  return { format: 'postman', title: String(root.info?.name ?? 'Collection'), tests, variables: [...variables.values()], warnings };
}
