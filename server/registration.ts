import { storage } from './storage';

/**
 * Who may create an account without an invitation.
 *
 * Registration without an invitation creates a new organization. It used to be open to anyone who
 * could reach the server, with no way to say otherwise: an installation meant for one company
 * handed an organization of their own to anybody who found the address. Now it is a choice:
 *
 * - `invitation` (the default): accounts are created from an invitation, which an owner sends.
 *   The one exception is the installation's first account, which has nobody to invite it.
 * - `open`: anyone who reaches the server can register and gets an organization of their own —
 *   what a service offering sign-up to the public wants.
 *
 * Registering with an invitation is always allowed; that is what an invitation is for.
 */
export type RegistrationMode = 'open' | 'invitation';

export const REGISTRATION_MODES: readonly RegistrationMode[] = ['open', 'invitation'];

/** A malformed value throws at startup rather than falling back: guessing wrong opens the door. */
export function registrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  const raw = env.REGISTRATION?.trim().toLowerCase();
  if (!raw) return 'invitation';
  if ((REGISTRATION_MODES as readonly string[]).includes(raw)) return raw as RegistrationMode;
  throw new Error(`REGISTRATION must be "open" or "invitation"; got "${env.REGISTRATION}".`);
}

export interface RegistrationPolicy {
  mode: RegistrationMode;
  /** Whether someone without an invitation may register right now. */
  selfRegistration: boolean;
  /** No account exists yet: the next registration sets the installation up. */
  firstAccount: boolean;
}

/** What the sign-in page needs to know to offer, or not offer, a registration form. */
export async function registrationPolicy(env: NodeJS.ProcessEnv = process.env): Promise<RegistrationPolicy> {
  const mode = registrationMode(env);
  const firstAccount = !(await storage.hasAnyPerson());
  return { mode, selfRegistration: mode === 'open' || firstAccount, firstAccount };
}
