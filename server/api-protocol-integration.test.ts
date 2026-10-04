import { describe, expect, it, vi } from 'vitest';
import { insertApiTestSchema } from '@shared/schema';
import { typedSnapshotOf } from '@shared/test-versioning';
import { runApiRequest, type OneConnectionFetch } from './api-test-runner';

const config = { timeoutMs: 1500, grpcMode: 'bidi', tls: { rootCa: '{{secret_grpc_ca}}', clientCertificate: '{{secret_grpc_cert}}', clientKey: '{{secret_grpc_key}}' } };
const definition = { name: 'Chat', method: 'GRPC', url: 'grpcs://service.test/chat.Service/Talk', protoDefinition: 'service proto', protocolConfig: config };

describe('saved and executed protocol configuration', () => {
  it('retains configuration references in saves and executable version snapshots', () => {
    expect(insertApiTestSchema.parse(definition)).toHaveProperty('protocolConfig', config);
    expect(typedSnapshotOf('api', definition)).toHaveProperty('protocolConfig', config);
  });

  it('rejects private keys pasted into a saved test', () => {
    expect(insertApiTestSchema.safeParse({ ...definition, protocolConfig: { tls: { clientCertificate: '{{secret_cert}}', clientKey: '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----' } } }).success).toBe(false);
  });

  it('resolves TLS from the current environment and retains future captures for execution', async () => {
    const runProtocol = vi.fn(async () => ({ status: 0, statusText: 'OK', headers: {}, body: { messages: [], count: 0 }, text: '' }));
    const fetcher = Object.assign(vi.fn(), { runProtocol }) as unknown as OneConnectionFetch;
    const body = JSON.stringify({ steps: [{ type: 'receive' }, { type: 'capture', name: 'token', property: 'token' }, { type: 'send', message: '{{capture.token}}' }, { type: 'end' }] });
    const vars = { secret_grpc_ca: 'CA fixture', secret_grpc_cert: 'cert fixture', secret_grpc_key: 'private fixture', 'capture.token': 'must-not-replace-the-conversation-capture' };
    const result = await runApiRequest({ ...definition, body } as any, vars, fetcher);
    expect(result.error).toBeUndefined();
    expect(runProtocol).toHaveBeenCalledWith(expect.objectContaining({ body, config: { ...config, tls: { rootCa: vars.secret_grpc_ca, clientCertificate: vars.secret_grpc_cert, clientKey: vars.secret_grpc_key } } }));
  });

  it('refuses unresolved TLS material before opening the transport', async () => {
    const runProtocol = vi.fn();
    const fetcher = Object.assign(vi.fn(), { runProtocol }) as unknown as OneConnectionFetch;
    const result = await runApiRequest(definition as any, {}, fetcher);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/unresolved|missing|define/i);
    expect(runProtocol).not.toHaveBeenCalled();
  });

  it('keeps a resolved private key out of a transport error', async () => {
    const secret = 'secret-key-body-from-environment';
    const runProtocol = vi.fn(async () => { throw new Error(`Invalid key: ${secret}`); });
    const fetcher = Object.assign(vi.fn(), { runProtocol }) as unknown as OneConnectionFetch;
    const result = await runApiRequest({ ...definition, protocolConfig: { tls: { clientCertificate: '{{secret_cert}}', clientKey: '{{secret_key}}' } } } as any, { secret_key: secret, secret_cert: 'certificate fixture' }, fetcher);
    expect(result.passed).toBe(false);
    expect(result.error).not.toContain(secret);
  });
});
