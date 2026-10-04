import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Application } from 'express';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { apiTests, auditLog, users, type User } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { tenancyMiddleware } from './middleware/tenancy';
import { exampleOf, importApiDescription, ImportError } from './api-import';
import { bundle, distributedWsdl } from './tests/soap-bundle-fixtures';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/** API tests made from an OpenAPI description or a Postman collection. */

const OPENAPI_YAML = `
openapi: 3.0.3
info: { title: Shop, version: "1" }
servers:
  - url: https://{region}.shop.example.com/v1
    variables: { region: { default: eu } }
security: [ { bearerAuth: [] } ]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
    keyAuth: { type: apiKey, in: header, name: X-Shop-Key }
  schemas:
    Order:
      type: object
      properties:
        id: { type: string, format: uuid, readOnly: true }
        sku: { type: string, example: ABC-1 }
        quantity: { type: integer, minimum: 1 }
        lines: { type: array, items: { $ref: '#/components/schemas/Line' } }
    Line:
      type: object
      properties: { note: { type: string } }
paths:
  /orders:
    get:
      tags: [orders]
      summary: List orders
      parameters:
        - { name: status, in: query, required: true, schema: { type: string, enum: [open, closed] } }
        - { name: page, in: query, schema: { type: integer } }
      responses: { "200": { description: ok } }
    post:
      tags: [orders]
      operationId: createOrder
      security: [ { keyAuth: [] } ]
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Order' }
      responses: { "201": { description: created }, "400": { description: bad } }
  /orders/{orderId}:
    parameters:
      - { name: orderId, in: path, required: true, schema: { type: string } }
    delete:
      responses: { "204": { description: gone } }
  /upload:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema: { type: object }
      responses: { "200": { description: ok } }
`;

const SWAGGER = {
  swagger: '2.0',
  info: { title: 'Legacy' },
  host: 'legacy.example.com',
  basePath: '/api',
  schemes: ['http', 'https'],
  securityDefinitions: { basic: { type: 'basic' } },
  definitions: { Pet: { type: 'object', properties: { name: { type: 'string', example: 'Rex' } } } },
  paths: {
    '/pets': {
      post: {
        security: [{ basic: [] }],
        parameters: [{ in: 'body', name: 'pet', schema: { $ref: '#/definitions/Pet' } }],
        responses: { 200: { description: 'ok' } },
      },
    },
  },
};

const POSTMAN = {
  info: { name: 'CRM', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: 'eyJ-literal-secret' }] },
  variable: [{ key: 'baseUrl', value: 'https://crm.example.com' }, { key: 'apiSecret', value: 's3cret' }],
  item: [
    {
      name: 'Customers',
      item: [
        {
          name: 'Create customer',
          event: [{ listen: 'test', script: { exec: ['pm.test("created", function () {', '  pm.response.to.have.status(201);', '});'] } }],
          request: {
            method: 'POST',
            header: [{ key: 'X-Trace', value: '{{traceId}}' }, { key: 'X-Off', value: '1', disabled: true }],
            body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } },
            url: { raw: '{{baseUrl}}/customers/:customerId?active=true', query: [{ key: 'active', value: 'true' }] },
          },
        },
      ],
    },
    {
      name: 'Search',
      event: [{ listen: 'test', script: { exec: ['pm.expect(pm.response.json().length).to.be.above(0);'] } }],
      request: { method: 'POST', url: '{{baseUrl}}/graphql', body: { mode: 'graphql', graphql: { query: '{ customers { id } }', variables: '{"first": 5}' } } },
    },
  ],
};

describe('reading an OpenAPI description', () => {
  const result = importApiDescription(OPENAPI_YAML);
  const byName = (name: string) => result.tests.find((t) => t.name === name)!;

  it('makes one test per operation, starting at {{baseUrl}}, with the server as the suggestion', () => {
    expect(result).toMatchObject({ format: 'openapi', title: 'Shop' });
    expect(result.tests.map((t) => `${t.method} ${t.url}`)).toEqual([
      'GET {{baseUrl}}/orders',
      'POST {{baseUrl}}/orders',
      'DELETE {{baseUrl}}/orders/{{orderId}}',
      'POST {{baseUrl}}/upload',
    ]);
    expect(result.variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://eu.shop.example.com/v1');
    expect(result.variables.map((v) => v.name)).toEqual(expect.arrayContaining(['orderId', 'token', 'keyAuth']));
  });

  it('fills required parameters, makes a body from the schema, and carries security as variables', () => {
    expect(byName('List orders')).toMatchObject({ queryParams: { status: 'open' }, module: 'orders', authType: 'bearer' });
    expect(byName('List orders').authParams).toEqual({ type: 'bearer', params: { token: '{{token}}' } });
    const create = byName('createOrder');
    expect(JSON.parse(create.requestBody!)).toEqual({ sku: 'ABC-1', quantity: 1, lines: [{ note: 'string' }] });
    expect(create.requestHeaders).toEqual({ 'Content-Type': 'application/json' });
    expect(create.authParams).toEqual({ type: 'apiKey', params: { key: 'X-Shop-Key', value: '{{keyAuth}}', addTo: 'header' } });
    expect(create.assertions[0]).toMatchObject({ source: 'status_code', comparison: 'equals', targetValue: '201' });
    expect(result.tests[2].assertions[0].targetValue).toBe('204');
  });

  it('says what it could not carry over', () => {
    expect(result.tests[3].warnings[0]).toContain('multipart/form-data');
  });

  it('survives a recursive schema', () => {
    const root = { components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } } };
    expect(() => exampleOf(root, { $ref: '#/components/schemas/Node' })).not.toThrow();
  });
});

describe('reading Swagger 2 and Postman', () => {
  it('takes Swagger 2: host and base path, body parameter, basic authentication', () => {
    const result = importApiDescription(JSON.stringify(SWAGGER));
    expect(result.variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://legacy.example.com/api');
    expect(result.tests[0]).toMatchObject({ method: 'POST', url: '{{baseUrl}}/pets', authType: 'basic', requestBody: '{\n  "name": "Rex"\n}' });
  });

  it('takes a Postman collection: folders, :params, query, headers, body, inherited auth without its secret, status from the script', () => {
    const result = importApiDescription(JSON.stringify(POSTMAN));
    const [create, search] = result.tests;
    expect(create).toMatchObject({
      name: 'Create customer',
      method: 'POST',
      url: '{{baseUrl}}/customers/{{customerId}}',
      queryParams: { active: 'true' },
      requestHeaders: { 'X-Trace': '{{traceId}}', 'Content-Type': 'application/json' },
      requestBody: '{"name":"Ada"}',
      module: 'Customers',
      authType: 'bearer',
    });
    expect(create.authParams).toEqual({ type: 'bearer', params: { token: '{{token}}' } });
    expect(JSON.stringify(result)).not.toContain('eyJ-literal-secret');
    expect(JSON.stringify(result)).not.toContain('s3cret');
    expect(create.assertions[0].targetValue).toBe('201');
    expect(create.warnings).toEqual([]);
    expect(search).toMatchObject({ bodyType: 'GraphQL', bodyGraphqlQuery: '{ customers { id } }' });
    expect(search.warnings[0]).toContain('test script');
    expect(result.variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://crm.example.com');
    expect(result.variables.map((v) => v.name)).toEqual(expect.arrayContaining(['traceId', 'customerId', 'token', 'apiSecret']));
  });

  it('refuses what is none of them', () => {
    expect(() => importApiDescription('')).toThrow(ImportError);
    expect(() => importApiDescription('{"hello": 1}')).toThrow(/Neither OpenAPI/);
    expect(() => importApiDescription('{ not json')).toThrow(ImportError);
  });
});

describe('POST /api/api-tests/import', () => {
  let app: Application;
  let user: User;

  beforeAll(async () => {
    app = express();
    app.use('/api/api-tests/import', express.json({ limit: '12mb' }));
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = user;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    app.use(tenancyMiddleware);
    app.use((await import('./routes/tests.routes')).default);
  });

  beforeEach(async () => {
    await privilegedDb.delete(apiTests);
    await privilegedDb.delete(auditLog);
    const organizationId = await createTestOrganization('Import Org');
    [user] = await privilegedDb.insert(users).values({ username: `importer-${Date.now()}`, password: 'x.y', organizationId, role: 'editor' }).returning();
  });

  it('previews without saving, then saves what was kept, once', async () => {
    const preview = await request(app).post('/api/api-tests/import').send({ content: OPENAPI_YAML, dryRun: true }).expect(200);
    expect(preview.body.tests).toHaveLength(4);
    expect(await privilegedDb.select().from(apiTests)).toEqual([]);

    const saved = await request(app).post('/api/api-tests/import').send({ content: OPENAPI_YAML, select: [0, 1] }).expect(201);
    expect(saved.body.created.map((t: { name: string }) => t.name)).toEqual(['List orders', 'createOrder']);
    const rows = await privilegedDb.select().from(apiTests).where(eq(apiTests.organizationId, user.organizationId));
    expect(rows.map((r) => r.url)).toEqual(['{{baseUrl}}/orders', '{{baseUrl}}/orders']);
    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'api_test.imported'));
    expect(entry.metadata).toMatchObject({ format: 'openapi', created: 2 });

    // A second import of the same file leaves what exists alone.
    const again = await request(app).post('/api/api-tests/import').send({ content: OPENAPI_YAML }).expect(201);
    expect(again.body.created).toHaveLength(2);
    expect(again.body.skipped.map((s: { name: string }) => s.name)).toEqual(['List orders', 'createOrder']);
    const preview2 = await request(app).post('/api/api-tests/import').send({ content: OPENAPI_YAML, dryRun: true }).expect(200);
    expect(preview2.body.tests.every((t: { exists: boolean }) => t.exists)).toBe(true);
  });

  it('answers 400 for a file it cannot read', async () => {
    const res = await request(app).post('/api/api-tests/import').send({ content: 'just text' }).expect(400);
    expect(res.body.error).toMatch(/Neither OpenAPI|Not an API description/);
  });

  it('previews and persists the same selected offline SOAP endpoint', async () => {
    const content = distributedWsdl;
    const preview = await request(app).post('/api/api-tests/import').send({content,documents:bundle,rootLocation:'service.wsdl',dryRun:true}).expect(200);
    const endpoint = preview.body.endpoints[1].id;
    const selected = await request(app).post('/api/api-tests/import').send({content,documents:bundle,endpoint,dryRun:true}).expect(200);
    expect(selected.body.selectedEndpoint).toBe(endpoint);
    expect(selected.body.variables[0].value).toBe('https://backup.example');
    expect(selected.body.tests[0].requestBody).toContain('OrderId');
    await request(app).post('/api/api-tests/import').send({content,documents:bundle,endpoint}).expect(201);
    const [saved] = await privilegedDb.select().from(apiTests).where(eq(apiTests.organizationId,user.organizationId));
    expect(saved.requestBody).toBe(selected.body.tests[0].requestBody);
    expect(saved.requestHeaders).toEqual(selected.body.tests[0].requestHeaders);
  });

  it('rejects an unknown endpoint and missing SOAP documents before saving', async () => {
    await request(app).post('/api/api-tests/import').send({content:distributedWsdl,documents:bundle,endpoint:'unknown'}).expect(400);
    await request(app).post('/api/api-tests/import').send({content:distributedWsdl}).expect(400);
    expect(await privilegedDb.select().from(apiTests)).toEqual([]);
  });

  it('lets a test with a variable address be saved and edited like any other', async () => {
    await request(app).post('/api/api-tests').send({ name: 'Health', method: 'GET', url: '{{baseUrl}}/health' }).expect(201);
    await request(app).post('/api/api-tests').send({ name: 'Bad', method: 'GET', url: 'not-a-url' }).expect(400);
  });
});
