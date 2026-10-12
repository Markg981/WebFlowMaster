import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { API_SCOPES } from '../shared/api-scopes';
import { openApiDocument } from '../server/api-v1/openapi';

/**
 * docs/{en,it}/reference/api-endpoints.md and docs/public/openapi.json, generated from the same
 * document the server serves at /api/v1/openapi.json (server/api-v1/openapi.ts, which
 * openapi.test.ts holds to the router). The hand-written docs/{en,it}/reference/api.md explains
 * authentication, conventions and workflows; this page lists every operation, so it cannot drift.
 *
 *   npx tsx scripts/generate-api-reference.ts           write the pages
 *   npx tsx scripts/generate-api-reference.ts --check   fail if a committed page is stale
 */

type Schema = {
  $ref?: string;
  type?: string | readonly string[];
  enum?: readonly unknown[];
  items?: Schema;
  oneOf?: readonly Schema[];
  anyOf?: readonly Schema[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  description?: string;
  format?: string;
  [key: string]: unknown;
};
type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
};
type Response = { description?: string; content?: Record<string, { schema?: Schema }> };
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  'x-required-scope'?: string;
  parameters?: readonly Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, Response>;
};
type Document = {
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const html = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;');

/**
 * A code span safe inside a table cell. Plain spans stay Markdown; one holding `|` or `\` becomes
 * HTML with entities, because GFM splits cells on `|` even inside backticks and a backslash there
 * is literal, so no Markdown escape renders both right.
 */
function codeSpan(span: string): string {
  const content = span.slice(1, -1);
  if (!/[|\\]/.test(content)) return span;
  return `<code>${html(content).replace(/\|/g, '&#124;').replace(/\\/g, '&#92;')}</code>`;
}

/** Text for a Markdown table cell: no raw HTML, no Vue interpolation, no table breaks. */
export function inline(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 ? codeSpan(part) : html(part).replace(/[\\|]/g, (character) => `\\${character}`),
    )
    .join('')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

/** Limits and defaults a reader needs, from the JSON Schema keywords. */
export function constraints(schema: Schema | undefined): string {
  if (!schema) return '';
  const facts: string[] = [];
  if (schema.minimum !== undefined && schema.maximum !== undefined)
    facts.push(`${schema.minimum}–${schema.maximum}`);
  else if (schema.minimum !== undefined) facts.push(`at least ${schema.minimum}`);
  else if (schema.maximum !== undefined) facts.push(`at most ${schema.maximum}`);
  if (schema.maxLength !== undefined) facts.push(`up to ${schema.maxLength} characters`);
  if (schema.maxItems !== undefined) facts.push(`up to ${schema.maxItems} items`);
  if (schema.pattern !== undefined) facts.push(`pattern \`${schema.pattern}\``);
  if (schema.default !== undefined) facts.push(`default \`${JSON.stringify(schema.default)}\``);
  return facts.join(', ');
}

const describe = (text: string | undefined, schema: Schema | undefined) =>
  inline([text ?? '', constraints(schema)].filter(Boolean).join(' '));

const GROUP_TITLES: Record<string, string> = {
  'api-tests': 'API tests',
  'mobile-tests': 'Mobile tests',
};
const groupTitle = (name: string) =>
  GROUP_TITLES[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

const anchor = (name: string) => `schema-${name.toLowerCase()}`;

/** A schema in one cell: `string`, `Run[]`, [Plan](#schema-plan), one of `a`, `b`. */
export function typeOf(schema: Schema | undefined): string {
  if (!schema) return '';
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()!;
    return `[${name}](#${anchor(name)})`;
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) return variants.map(typeOf).join(' or ');
  if (schema.enum) return `one of ${schema.enum.map((v) => `\`${String(v)}\``).join(', ')}`;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  return types
    .map((type) => {
      if (type === 'array') return `${typeOf(schema.items) || 'any'}[]`;
      if (type === 'object' && schema.properties) {
        const fields = Object.entries(schema.properties).map(([name, field]) => {
          const inner = field.$ref || field.type === 'array' ? `: ${typeOf(field)}` : '';
          return `${name}${inner}`;
        });
        return `object { ${fields.join(', ')} }`;
      }
      if (type === 'string' && schema.format) return `string (${schema.format})`;
      return type;
    })
    .join(' \\| ');
}

function fieldRows(schema: Schema): string[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(
    ([name, field]) =>
      `| \`${name}\` | ${typeOf(field)} | ${required.has(name) ? 'yes' : ''} | ${describe(field.description, field)} |`,
  );
}

function fieldTable(schema: Schema | undefined): string[] {
  if (!schema) return [];
  if (!schema.properties) return [`${typeOf(schema)}`, ''];
  return [
    '| Field | Type | Required | Description |',
    '|---|---|---|---|',
    ...fieldRows(schema),
    '',
  ];
}

function group(operation: Operation, route: string): string {
  return operation['x-required-scope']?.split(':')[0] ?? route.split('/')[3];
}

export function renderOperations(document: Document): string[] {
  const order = [...new Set(Object.keys(API_SCOPES).map((scope) => scope.split(':')[0]))];
  const groups = new Map<string, Array<{ method: string; route: string; operation: Operation }>>();
  for (const [route, item] of Object.entries(document.paths))
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const name = group(operation, route);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push({ method, route, operation });
    }
  const names = [...groups.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b),
  );

  const lines: string[] = [];
  for (const name of names) {
    lines.push(`## ${groupTitle(name)}`, '');
    for (const { method, route, operation } of groups.get(name)!) {
      lines.push(`### \`${method.toUpperCase()} ${route}\` {#${operation.operationId}}`, '');
      if (operation.summary) lines.push(inline(operation.summary), '');
      if (operation.description) lines.push(inline(operation.description), '');
      const facts = [
        operation['x-required-scope'] && `Scope \`${operation['x-required-scope']}\``,
        operation.operationId && `operation \`${operation.operationId}\``,
      ].filter(Boolean);
      lines.push(facts.join(' · '), '');
      if (operation.parameters?.length)
        lines.push(
          '| Parameter | In | Type | Required | Description |',
          '|---|---|---|---|---|',
          ...operation.parameters.map(
            (p) =>
              `| \`${p.name}\` | ${p.in} | ${typeOf(p.schema)} | ${p.required ? 'yes' : ''} | ${describe(p.description ?? p.schema?.description, p.schema)} |`,
          ),
          '',
        );
      for (const [type, media] of Object.entries(operation.requestBody?.content ?? {})) {
        const optional = operation.requestBody?.required ? '' : ', optional';
        lines.push(`**Request body** (\`${type}\`${optional})`, '', ...fieldTable(media.schema));
      }
      const responses = Object.entries(operation.responses ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (responses.length)
        lines.push(
          '| Status | Meaning | Body |',
          '|---|---|---|',
          ...responses.map(([status, response]) => {
            const bodies = Object.entries(response.content ?? {})
              .map(([type, media]) => `${typeOf(media.schema)} (\`${type}\`)`)
              .join('<br>');
            return `| ${status} | ${inline(response.description ?? '')} | ${bodies} |`;
          }),
          '',
        );
    }
  }
  return lines;
}

export function renderSchemas(document: Document): string[] {
  const lines = ['## Schemas', ''];
  for (const name of Object.keys(document.components.schemas).sort()) {
    const schema = document.components.schemas[name];
    lines.push(`### ${name} {#${anchor(name)}}`, '');
    if (schema.description) lines.push(inline(schema.description), '');
    lines.push(...fieldTable(schema));
  }
  return lines;
}

export function countOperations(document: Document): number {
  return Object.values(document.paths).reduce(
    (n, item) => n + METHODS.filter((method) => item[method]).length,
    0,
  );
}

const INTRO = {
  en: (operations: number, version: string) => [
    '# API endpoints',
    '',
    `Generated from the OpenAPI document the server serves at \`/api/v1/openapi.json\` (API version ${version}) with \`npm run docs:api-reference\`; do not edit it by hand. Authentication, scopes, conventions and complete workflows are explained in the [REST API guide](./api). Download the same document as [openapi.json](/openapi.json) to import it into Postman, Insomnia or a client generator.`,
    '',
    `**${operations} operations.** Each one names the scope its API key needs; a key without it gets 403.`,
    '',
  ],
  it: (operations: number, version: string) => [
    '# Endpoint dell’API',
    '',
    `Generata dal documento OpenAPI che il server espone in \`/api/v1/openapi.json\` (versione dell’API ${version}) con \`npm run docs:api-reference\`; non va modificata a mano. Le descrizioni restano in inglese, come nel documento. Autenticazione, scope, convenzioni e flussi completi sono spiegati nella [guida all’API REST](./api). Lo stesso documento si scarica come [openapi.json](/openapi.json) per importarlo in Postman, Insomnia o in un generatore di client.`,
    '',
    `**${operations} operazioni.** Ognuna indica lo scope che la chiave API deve avere; una chiave senza riceve 403.`,
    '',
  ],
};

export async function renderPages(document: Document, root: string) {
  const body = [...renderOperations(document), ...renderSchemas(document)];
  const operations = countOperations(document);
  const pages: Array<{ file: string; content: string }> = [];
  for (const lang of ['en', 'it'] as const) {
    const file = path.join(root, 'docs', lang, 'reference', 'api-endpoints.md');
    const options = (await prettier.resolveConfig(file)) ?? {};
    const markdown = [...INTRO[lang](operations, document.info.version), ...body].join('\n');
    pages.push({
      file,
      content: await prettier.format(markdown, { ...options, parser: 'markdown' }),
    });
  }
  const json = path.join(root, 'docs', 'public', 'openapi.json');
  pages.push({
    file: json,
    content: await prettier.format(JSON.stringify(document), {
      ...((await prettier.resolveConfig(json)) ?? {}),
      parser: 'json',
    }),
  });
  return pages;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const pages = await renderPages(openApiDocument as unknown as Document, root);
  const stale: string[] = [];
  for (const { file, content } of pages) {
    const relative = path.relative(root, file);
    if (check) {
      const current = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
        : '';
      if (current !== content) stale.push(relative);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`Wrote ${relative}`);
  }
  if (stale.length) {
    console.error(`Stale, run npm run docs:api-reference: ${stale.join(', ')}`);
    process.exit(1);
  }
}
