import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
vi.mock('../queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: { add: vi.fn() },
}));

const { default: router } = await import('../routes/api-v1.routes');
const { openApiDocument } = await import('./openapi');
const { API_SCOPE_NAMES } = await import('@shared/api-scopes');
const { authoringSchemas: runtimeSchemas } = await import('./authoring');

/**
 * The document and the router say the same thing.
 *
 * A generated client believes the document, so an endpoint missing from it cannot be called,
 * one in it that the router lacks fails at run time, and a scope that differs from the guard's
 * sends people to create keys that do not work.
 */

type Layer = {
  route?: {
    path: string | RegExp;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { scope?: string } }>;
  };
};

function served() {
  const operations = new Map<string, string | undefined>();
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    const route = layer.route;
    if (!route || typeof route.path !== 'string') continue; // the catch-all for unknown paths
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    for (const method of Object.keys(route.methods)) {
      if (method === '_all') continue;
      const scope = route.stack.map((s) => s.handle.scope).find(Boolean);
      operations.set(`${method.toUpperCase()} ${path}`, scope);
    }
  }
  return operations;
}

function documented() {
  const operations = new Map<string, string | undefined>();
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const [method, operation] of Object.entries(
      item as Record<string, { 'x-required-scope'?: string }>,
    )) {
      operations.set(`${method.toUpperCase()} ${path}`, operation['x-required-scope']);
    }
  }
  // The document describes itself only by existing.
  operations.set('GET /api/v1/openapi.json', undefined);
  return operations;
}

describe('the OpenAPI document', () => {
  it('documents both suite import success statuses and execution limits', () => {
    const imported = openApiDocument.paths['/api/v1/suites/import'].post;
    expect(imported.responses).toHaveProperty('200');
    expect(imported.responses).toHaveProperty('201');
    const fields = openApiDocument.components.schemas.PlanInput.properties;
    expect(fields.maxParallelTests).toMatchObject({ maximum: 16 });
    expect(fields.shards).toMatchObject({ maximum: 8 });
    expect(fields.locales).toMatchObject({ maxItems: 10 });
    expect(fields.pageLoadTimeout).toMatchObject({ minimum: 1000, maximum: 600000 });
  });
  it('describes the exact authoring input field allowlists', () => {
    const pairs = [
      ['ProjectInput', 'projectCreateSchema'],
      ['ProjectPatch', 'projectUpdateSchema'],
      ['TestInput', 'testCreateSchema'],
      ['TestPatch', 'testUpdateSchema'],
      ['DatasetInput', 'datasetCreateSchema'],
      ['DatasetInput', 'datasetUpdateSchema'],
      ['PlanInput', 'planCreateSchema'],
      ['PlanPatch', 'planUpdateSchema'],
      ['SuiteExportInput', 'suiteExportSchema'],
      ['SuiteImportInput', 'suiteImportSchema'],
    ] as const;
    for (const [documentedName, runtimeName] of pairs) {
      let schema: any = runtimeSchemas[runtimeName];
      while (schema._def.schema) schema = schema._def.schema;
      const described = openApiDocument.components.schemas[documentedName];
      expect(Object.keys(described.properties).sort(), documentedName).toEqual(
        Object.keys(schema.shape).sort(),
      );
      expect(described.additionalProperties, documentedName).toBe(false);
      const required = Object.entries(schema.shape)
        .filter(([, field]) => !(field as any).isOptional())
        .map(([name]) => name)
        .sort();
      expect([...described.required].sort(), documentedName).toEqual(required);
    }
  });
  it('lists every endpoint the router serves, and no other', () => {
    expect([...documented().keys()].sort()).toEqual([...served().keys()].sort());
  });

  it('names, for each endpoint, the scope its guard checks', () => {
    const guards = served();
    for (const [operation, scope] of documented()) {
      expect(scope, operation).toBe(guards.get(operation));
    }
  });

  it('guards every endpoint but its own description, with a scope that exists', () => {
    for (const [operation, scope] of served()) {
      if (operation === 'GET /api/v1/openapi.json') continue;
      expect(API_SCOPE_NAMES, operation).toContain(scope);
    }
  });

  it('gives every operation a unique id, for the names of generated methods', () => {
    const ids = Object.values(openApiDocument.paths).flatMap((item) =>
      Object.values(item as Record<string, { operationId: string }>).map((op) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
