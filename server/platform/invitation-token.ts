import { createHash } from 'node:crypto';

/**
 * An invitation token is stored the way a password-reset token or an API key is: only its SHA-256.
 * `invitations.token` holds this hash, never the token (migration 0095); the person gets the token
 * once, in the link, and the lookup hashes what it is given.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
