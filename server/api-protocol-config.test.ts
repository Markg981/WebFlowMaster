import { describe, expect, it } from 'vitest';
import { ProtocolConfigSchema, ResolvedProtocolConfigSchema, protocolLimits } from '@shared/api-protocol-config';
import { ConversationPlanSchema } from '@shared/protocol-conversation';

describe('protocol contracts', () => {
  it('bounds resolved secret material by UTF-8 bytes, including an encrypted-key passphrase', () => {
    expect(ResolvedProtocolConfigSchema.safeParse({ tls: { clientCertificate: 'certificate', clientKey: 'key', keyPassphrase: 'é'.repeat(200000) } }).success).toBe(false);
  });
  it('accepts exact references and rejects plaintext, incomplete pairs and bounds', () => {
    expect(
      ProtocolConfigSchema.parse({
        tls: { clientCertificate: '{{secret_cert}}', clientKey: '{{secret_key}}' },
      }),
    ).toBeTruthy();
    for (const config of [
      { tls: { clientKey: 'PRIVATE KEY' } },
      { tls: { clientCertificate: '{{secret_cert}}' } },
      { maxMessages: 1001 },
      { timeoutMs: 60001 },
      { maxBytes: 8388609 },
    ])
      expect(ProtocolConfigSchema.safeParse(config).success).toBe(false);
    expect(protocolLimits()).toEqual({ timeoutMs: 30000, maxMessages: 100, maxBytes: 1048576 });
  });
  it('validates capture order and names', () => {
    expect(
      ConversationPlanSchema.safeParse({ steps: [{ type: 'capture', name: 'token' }] }).success,
    ).toBe(false);
    expect(
      ConversationPlanSchema.safeParse({
        steps: [
          { type: 'receive' },
          { type: 'capture', name: 'token' },
          { type: 'send', message: '{{capture.token}}' },
        ],
      }).success,
    ).toBe(true);
    expect(
      ConversationPlanSchema.safeParse({
        steps: [{ type: 'receive' }, { type: 'capture', name: 'secret.x' }],
      }).success,
    ).toBe(false);
  });
});
