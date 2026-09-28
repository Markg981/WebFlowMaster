import { describe, expect, it } from 'vitest';
import { redactHistoryEntry } from './history-redaction';

const env = { apiBase: 'https://httpbin.org', token: 's3cr3t-staging-token' };

describe('redactHistoryEntry', () => {
  it('puts an environment value echoed in the response body back to its placeholder', () => {
    const entry = redactHistoryEntry(
      {
        url: '{{apiBase}}/bearer',
        responseBody: JSON.stringify({ authenticated: true, token: env.token }),
      },
      env,
    );
    expect(entry.url).toBe('{{apiBase}}/bearer');
    expect(entry.responseBody).not.toContain(env.token);
    expect(JSON.parse(entry.responseBody!)).toEqual({ authenticated: true, token: '{{token}}' });
  });

  it('replaces environment values under keys that are not sensitive by name', () => {
    const entry = redactHistoryEntry(
      { responseBody: JSON.stringify({ echo: `Bearer ${env.token}`, origin: `${env.apiBase}/get` }) },
      env,
    );
    expect(JSON.parse(entry.responseBody!)).toEqual({
      echo: 'Bearer {{token}}',
      origin: '{{apiBase}}/get',
    });
  });

  it('blanks credentials the environment never held', () => {
    const entry = redactHistoryEntry(
      {
        responseBody: JSON.stringify({ access_token: 'fresh-from-login', user: 'ada' }),
        responseHeaders: { 'set-cookie': 'sid=abc', 'content-type': 'application/json' },
        requestHeaders: { Authorization: 'Bearer typed-in-literally' },
      },
      {},
    );
    expect(JSON.parse(entry.responseBody!)).toEqual({ access_token: '[REDACTED]', user: 'ada' });
    expect(entry.responseHeaders).toEqual({ 'set-cookie': '[REDACTED]', 'content-type': 'application/json' });
    expect(entry.requestHeaders).toEqual({ Authorization: '[REDACTED]' });
  });

  it('keeps a credential field that only names a variable, so the entry can be replayed', () => {
    const entry = redactHistoryEntry(
      { requestHeaders: { Authorization: 'Bearer {{token}}', 'X-Api-Key': env.token } },
      env,
    );
    expect(entry.requestHeaders).toEqual({ Authorization: 'Bearer {{token}}', 'X-Api-Key': '{{token}}' });
  });

  it('scrubs a text body and leaves an untouched one byte-for-byte', () => {
    expect(redactHistoryEntry({ responseBody: `token=${env.token}` }, env).responseBody).toBe('token=[REDACTED]');
    const pretty = '{\n  "ok": true\n}';
    expect(redactHistoryEntry({ responseBody: pretty }, env).responseBody).toBe(pretty);
  });

  it('ignores values too short to replace safely', () => {
    const entry = redactHistoryEntry({ responseBody: '{"count":1}' }, { retries: '1' });
    expect(entry.responseBody).toBe('{"count":1}');
  });
});
