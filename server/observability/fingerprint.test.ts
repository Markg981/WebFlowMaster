import { describe, it, expect } from 'vitest';
import { normaliseMessage, fingerprintError, incidentIdFromFingerprint } from './fingerprint';
import type { StackFrame } from '../../shared/observability';

const frame = (file: string, line: number): StackFrame => ({
  functionName: 'doThing', file, line, column: 1, app: true,
});

describe('normaliseMessage', () => {
  it('strips uuids, numbers and quoted values so variants collapse', () => {
    const a = normaliseMessage('Session 4f2a8c11-1d3e-4b7a-9f10-0c2e5a7b1234 failed after 1523ms');
    const b = normaliseMessage('Session 9a1b7c33-2e4f-4c8b-8a20-1d3f6b8c2345 failed after 87ms');
    expect(a).toBe(b);
  });

  it('strips absolute paths', () => {
    const a = normaliseMessage('ENOENT: no such file, open /home/ci/app/data/x.json');
    const b = normaliseMessage('ENOENT: no such file, open C:\\Users\\marco\\app\\data\\x.json');
    expect(a).toBe(b);
  });

  it('keeps genuinely different messages different', () => {
    expect(normaliseMessage('Cannot read selector')).not.toBe(normaliseMessage('Cannot read value'));
  });

  it('keeps different URLs apart while still collapsing ids inside one URL', () => {
    // Different endpoints are different bugs and must not share a fingerprint.
    expect(normaliseMessage('HTTP 500 from POST https://app.test/api/setup-user'))
      .not.toBe(normaliseMessage('HTTP 404 from POST https://app.test/api/setup-order'));

    // The same endpoint with different record ids is one bug.
    expect(normaliseMessage('GET https://app.test/api/orders/1234 failed'))
      .toBe(normaliseMessage('GET https://app.test/api/orders/9876 failed'));
  });
});

describe('fingerprintError', () => {
  it('is stable for the same error', () => {
    const input = { kind: 'server-api' as const, message: 'boom', frames: [frame('server/a.ts', 10)] };
    expect(fingerprintError(input)).toBe(fingerprintError(input));
  });

  it('ignores vendor frames', () => {
    const appOnly = { kind: 'server-api' as const, message: 'boom', frames: [frame('server/a.ts', 10)] };
    const withVendor = {
      kind: 'server-api' as const,
      message: 'boom',
      frames: [
        frame('server/a.ts', 10),
        { functionName: 'x', file: 'node_modules/express/lib/router.js', line: 99, column: 1, app: false },
      ],
    };
    expect(fingerprintError(withVendor)).toBe(fingerprintError(appOnly));
  });

  it('separates different kinds with the same error', () => {
    const frames = [frame('server/a.ts', 10)];
    expect(fingerprintError({ kind: 'server-api', message: 'boom', frames }))
      .not.toBe(fingerprintError({ kind: 'job', message: 'boom', frames }));
  });

  it('separates different origin lines', () => {
    expect(fingerprintError({ kind: 'job', message: 'boom', frames: [frame('server/a.ts', 10)] }))
      .not.toBe(fingerprintError({ kind: 'job', message: 'boom', frames: [frame('server/a.ts', 20)] }));
  });
});

describe('incidentIdFromFingerprint', () => {
  it('is the inc_ prefix plus six hex characters', () => {
    const id = incidentIdFromFingerprint('abcdef0123456789');
    expect(id).toBe('inc_abcdef');
  });
});
