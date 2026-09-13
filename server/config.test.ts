import { describe, it, expect } from 'vitest';
import { resolvePort, sessionCookieSecure } from './config';

/**
 * The port the server listens on.
 *
 * It was `const port = 5000;` under a comment reading "ALWAYS serve the app on port 5000 …
 * It is the only port that is not firewalled" — true of Replit, where this started, and
 * false everywhere it runs now. PORT was accepted by nothing, so two instances could not
 * coexist on one host and a reverse proxy had to be bent around the app rather than
 * configured.
 */

describe('resolvePort', () => {
  it('defaults to 5000, which is what every existing setup expects', () => {
    expect(resolvePort({})).toBe(5000);
  });

  it('takes PORT when it is set', () => {
    expect(resolvePort({ PORT: '8080' })).toBe(8080);
  });

  it('rejects a value that is not a usable port rather than silently defaulting', () => {
    // Silently falling back would bind 5000 while the operator believes they set 99999,
    // and the only symptom would be a proxy pointing at nothing.
    expect(() => resolvePort({ PORT: '99999' })).toThrow(/PORT/);
    expect(() => resolvePort({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => resolvePort({ PORT: '0' })).toThrow(/PORT/);
    expect(() => resolvePort({ PORT: '-1' })).toThrow(/PORT/);
  });

  it('ignores an empty PORT, which is how an unset .env entry arrives', () => {
    // `PORT=` in a .env file reaches the process as an empty string, not as undefined.
    expect(resolvePort({ PORT: '' })).toBe(5000);
    expect(resolvePort({ PORT: '   ' })).toBe(5000);
  });

  it('accepts the edges of the valid range', () => {
    expect(resolvePort({ PORT: '1' })).toBe(1);
    expect(resolvePort({ PORT: '65535' })).toBe(65535);
  });
});

describe('sessionCookieSecure', () => {
  it('is on in production, because a session cookie over plaintext is a session anyone can take', () => {
    expect(sessionCookieSecure({ NODE_ENV: 'production' })).toBe(true);
  });

  it('is off in development, where there is no TLS to require', () => {
    expect(sessionCookieSecure({ NODE_ENV: 'development' })).toBe(false);
    expect(sessionCookieSecure({})).toBe(false);
  });

  it('can be turned off deliberately for a stack served over plain HTTP', () => {
    // Without this the shipped docker-compose stack cannot be logged into at all: the
    // browser drops the cookie, /api/login answers 200, and every request after it is
    // anonymous with nothing anywhere saying why.
    expect(sessionCookieSecure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toBe(false);
  });

  it('can be turned on in development, for testing behind a TLS proxy', () => {
    expect(sessionCookieSecure({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'true' })).toBe(true);
  });

  it('ignores a value it does not understand rather than guessing', () => {
    // Guessing either way is worse than the default: "yes" reading as false would silently
    // expose the cookie, and reading as true would silently break every login.
    expect(sessionCookieSecure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'yes' })).toBe(true);
    expect(sessionCookieSecure({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'yes' })).toBe(false);
  });
});
