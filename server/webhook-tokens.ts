import { randomBytes } from 'node:crypto';
import { hashApiKey } from './api-keys';

/**
 * The secret a CI system uses to start a plan through its webhook.
 *
 * Kept like an API key, for the same reason (see server/api-keys.ts): 32 random bytes have
 * nothing to guess, so a single SHA-256 is the right primitive, and it makes the lookup one
 * indexed query. The token leaves the server once, when the webhook is created; the row holds
 * its hash and the first few characters to tell webhooks apart.
 */

/** Marks the string as a webhook token in a pipeline's secrets and in a pasted log. */
export const WEBHOOK_TOKEN_PREFIX = 'wfmwh';
const VISIBLE_PREFIX_LENGTH = 12;

export interface GeneratedWebhookToken {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}

export function generateWebhookToken(): GeneratedWebhookToken {
  const token = `${WEBHOOK_TOKEN_PREFIX}_${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashWebhookToken(token), tokenPrefix: token.slice(0, VISIBLE_PREFIX_LENGTH) };
}

export const hashWebhookToken = hashApiKey;

/**
 * The token a webhook call carries.
 *
 * In a header by preference — `X-Webhook-Token`, or `Authorization: Bearer` — because a secret in
 * a URL is written into every access log and proxy log it passes through. In the path too,
 * because that is the URL every existing pipeline was given, and breaking them to make a point
 * would help nobody; the request log masks it (see server/index.ts).
 */
export function webhookTokenFromRequest(
  headers: { authorization?: string | string[]; 'x-webhook-token'?: string | string[] },
  pathToken?: string,
): string | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const explicit = first(headers['x-webhook-token'])?.trim();
  if (explicit) return explicit;
  const bearer = /^Bearer\s+(.+)$/i.exec(first(headers.authorization)?.trim() ?? '')?.[1]?.trim();
  if (bearer) return bearer;
  return pathToken?.trim() || null;
}

/** A request path with any webhook token in it replaced, for logs. */
export function redactWebhookPath(path: string): string {
  return path.replace(/(\/api\/webhooks\/execute\/)[^/?#]+/, '$1[redacted]');
}
