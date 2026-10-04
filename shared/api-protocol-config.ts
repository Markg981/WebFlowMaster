import { z } from 'zod';

export const PROTOCOL_DEFAULTS = {
  timeoutMs: 30_000,
  maxMessages: 100,
  maxBytes: 1024 * 1024,
} as const;
export const PROTOCOL_HARD_LIMITS = {
  timeoutMs: 60_000,
  maxMessages: 1000,
  maxBytes: 8 * 1024 * 1024,
  maxSteps: 100,
  maxPemBytes: 256 * 1024,
} as const;
const limits = {
  timeoutMs: z.number().int().min(1).max(PROTOCOL_HARD_LIMITS.timeoutMs).optional(),
  maxMessages: z.number().int().min(1).max(PROTOCOL_HARD_LIMITS.maxMessages).optional(),
  maxBytes: z.number().int().min(1).max(PROTOCOL_HARD_LIMITS.maxBytes).optional(),
  grpcMode: z.enum(['auto', 'unary', 'server_stream', 'client_stream', 'bidi']).optional(),
};
const reference = z
  .string()
  .max(256)
  .regex(/^\{\{secret_[A-Za-z0-9_]+\}\}$/);
const tlsFields = (value: z.ZodString) =>
  z
    .object({
      rootCa: value.optional(),
      clientCertificate: value.optional(),
      clientKey: value.optional(),
      keyPassphrase: value.optional(),
    })
    .strict();
const validatePair = (
  v: { tls?: { clientCertificate?: string; clientKey?: string; keyPassphrase?: string } },
  ctx: z.RefinementCtx,
) => {
  if (Boolean(v.tls?.clientCertificate) !== Boolean(v.tls?.clientKey))
    ctx.addIssue({
      code: 'custom',
      path: ['tls'],
      message: 'Client certificate and key must be supplied together.',
    });
  if (v.tls?.keyPassphrase && !v.tls.clientKey)
    ctx.addIssue({ code: 'custom', path: ['tls'], message: 'A passphrase requires a client key.' });
};
export const ProtocolConfigSchema = z
  .object({ ...limits, tls: tlsFields(reference).optional() })
  .strict()
  .superRefine(validatePair);
export type ProtocolConfig = z.infer<typeof ProtocolConfigSchema>;
export const ResolvedProtocolConfigSchema = z
  .object({
    ...limits,
    tls: tlsFields(z.string().min(1).max(PROTOCOL_HARD_LIMITS.maxPemBytes)).optional(),
  })
  .strict()
  .superRefine(validatePair)
  .superRefine((value, ctx) => {
    for (const [name, material] of Object.entries(value.tls ?? {})) {
      if (
        material &&
        new TextEncoder().encode(material).byteLength > PROTOCOL_HARD_LIMITS.maxPemBytes
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['tls', name],
          message: 'Resolved TLS material exceeds 256 KiB.',
        });
      }
    }
  });
export type ResolvedProtocolConfig = z.infer<typeof ResolvedProtocolConfigSchema>;
export function protocolLimits(config?: ResolvedProtocolConfig, fallbackTimeoutMs?: number) {
  const parsed = ResolvedProtocolConfigSchema.parse(config ?? {});
  return {
    timeoutMs:
      parsed.timeoutMs ??
      Math.min(
        Math.max(fallbackTimeoutMs ?? PROTOCOL_DEFAULTS.timeoutMs, 1),
        PROTOCOL_HARD_LIMITS.timeoutMs,
      ),
    maxMessages: parsed.maxMessages ?? PROTOCOL_DEFAULTS.maxMessages,
    maxBytes: parsed.maxBytes ?? PROTOCOL_DEFAULTS.maxBytes,
  };
}
