import { expect, it, vi } from 'vitest';
import { runTest } from './test-execution-service';
import { protocolReport } from './api-protocol-report';
import type { ApiTest } from '@shared/schema';

it('redacts credentials inside whole-message captures and their later echoes', () => {
  const token = 'whole-message-private-token';
  const report = protocolReport(
    {
      status: 101,
      statusText: 'OK',
      headers: {},
      body: {
        messages: [{ value: token }],
        captures: { reply: JSON.stringify({ access_token: token }) },
      },
      durationMs: 1,
      passed: true,
      assertions: [],
      extracted: {},
      extractionErrors: [],
    },
    {},
  );
  expect(JSON.stringify(report)).not.toContain(token);
});

it('records a bounded protocol transcript with secrets redacted while preserving live extraction reuse', async () => {
  const token = 'fresh-conversation-private-token';
  const environmentValue = 'environment-private-value';
  const body = {
    messages: [{ token }, { value: token, echo: environmentValue }],
    last: { value: token },
    count: 2,
    captures: { token },
  };
  const http = Object.assign(vi.fn(), {
    runProtocol: vi.fn(async () => ({
      status: 101,
      statusText: 'OK',
      headers: {},
      body,
      text: JSON.stringify(body),
    })),
  });
  const test = {
    id: 1,
    name: 'Conversation',
    method: 'WEBSOCKET',
    url: 'ws://fixture.test',
    requestBody: '{}',
    protocolConfig: { maxMessages: 2 },
    assertions: [
      {
        id: 'failure',
        enabled: true,
        source: 'body_json_path',
        property: 'last.value',
        comparison: 'equals',
        targetValue: 'wrong',
      },
    ],
    extractions: [
      { id: 'token', name: 'token', source: 'body_json_path', property: 'captures.token' },
    ],
  } as unknown as ApiTest;
  const result = await runTest(
    test,
    1,
    'plan',
    'run',
    'api',
    { secret_value: environmentValue },
    undefined,
    { http: http as any },
  );
  expect(result.extracted).toEqual({ token });
  expect((result as any).protocol).toMatchObject({ status: 101, body: { count: 2 } });
  const persisted = JSON.stringify((result as any).protocol);
  expect(persisted).not.toContain(token);
  expect(persisted).not.toContain(environmentValue);
  expect(result.error).not.toContain(token);
});
