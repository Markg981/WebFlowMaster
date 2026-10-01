/**
 * What a new password must be. Checked when one is chosen — registration, a change, a reset link —
 * never against passwords already stored.
 *
 * - basic (the default): 8 to 128 characters, and not the username.
 * - strong (PASSWORD_POLICY=strong): at least 12 characters, at least three of lowercase,
 *   uppercase, digits and symbols, not containing the username (or the part of an address before
 *   the @), and not one of the passwords every guessing list starts with.
 *
 * The answer is a sentence the sign-in page shows as it is.
 */

export type PasswordPolicy = 'basic' | 'strong';

export const PASSWORD_MAX_LENGTH = 128;

/** The start of every guessing list, lowercased; a password matching one, with digits or symbols trimmed, is refused. */
const COMMON = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'administrator', 'changeme',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'master', 'login', 'abc123',
  '123456', '12345678', '123456789', '1234567890', '111111', '000000', 'trustno1', 'secret', 'azerty', 'passwort',
]);

export function policyFrom(value: string | undefined): PasswordPolicy {
  return value?.trim().toLowerCase() === 'strong' ? 'strong' : 'basic';
}

/** Null when the password is acceptable; otherwise why not. */
export function passwordProblem(password: string, username: string | null | undefined, policy: PasswordPolicy): string | null {
  const min = policy === 'strong' ? 12 : 8;
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  const name = (username ?? '').trim().toLowerCase();
  const lower = password.toLowerCase();
  if (name && lower === name) return 'Password must not be the username.';
  if (policy === 'basic') return null;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Password must mix at least three of: lowercase letters, uppercase letters, digits, symbols.';
  const local = name.split('@')[0];
  if (local.length >= 3 && lower.includes(local)) return 'Password must not contain the username.';
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (COMMON.has(lower) || COMMON.has(core)) return 'This password is too common: it is among the first ones guessed.';
  return null;
}
