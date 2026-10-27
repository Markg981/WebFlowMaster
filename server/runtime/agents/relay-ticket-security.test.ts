import { describe, it, expect, vi } from 'vitest';

vi.mock('../../platform/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() },
  updateLogLevel: vi.fn(),
}));

const { AgentRelay } = await import('./relay');
const { relaySecret, signTicket, verifyTicket } = await import('./agent-credentials');

const base = {
  organizationId: 1,
  pool: 'onprem',
  engine: 'chromium' as const,
  headless: true,
  playwrightVersion: '1.0.0',
};

function ticketOf(secret: string) {
  const ticket = verifyTicket(signTicket(base, secret), secret);
  if ('error' in ticket) throw new Error(ticket.error);
  return ticket;
}

describe('relay secret (audit A-12)', () => {
  it('requires AGENT_RELAY_SECRET in production, with no fallback to SESSION_SECRET', () => {
    expect(() =>
      relaySecret({ NODE_ENV: 'production', SESSION_SECRET: 's' } as NodeJS.ProcessEnv),
    ).toThrow(/AGENT_RELAY_SECRET must be set in production/);
    expect(
      relaySecret({ NODE_ENV: 'production', AGENT_RELAY_SECRET: 'r' } as NodeJS.ProcessEnv),
    ).toBe('r');
  });

  it('falls back to SESSION_SECRET outside production, and still needs one of them', () => {
    expect(
      relaySecret({ NODE_ENV: 'development', SESSION_SECRET: 's' } as NodeJS.ProcessEnv),
    ).toBe('s');
    expect(() => relaySecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('single-use tickets (audit A-12)', () => {
  it('gives every ticket its own id', () => {
    const a = ticketOf('k');
    const b = ticketOf('k');
    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti);
  });

  it('accepts a ticket once within its lifetime and refuses the replay', async () => {
    const relay = new AgentRelay({ authenticate: async () => null, secret: () => 'k' });
    const claim = (t: ReturnType<typeof ticketOf>) =>
      (relay as any).claimTicket(t) as Promise<boolean>;
    const ticket = ticketOf('k');
    expect(await claim(ticket)).toBe(true);
    expect(await claim(ticket)).toBe(false);
    expect(await claim(ticketOf('k'))).toBe(true);
  });

  it('delegates the claim to the shared store when there is one (several instances)', async () => {
    const seen = new Set<string>();
    const claimTicket = vi.fn(async (jti: string) => !seen.has(jti) && !!seen.add(jti));
    const relay = new AgentRelay({ authenticate: async () => null, secret: () => 'k', claimTicket });
    const ticket = ticketOf('k');
    expect(await (relay as any).claimTicket(ticket)).toBe(true);
    expect(await (relay as any).claimTicket(ticket)).toBe(false);
    expect(claimTicket).toHaveBeenCalledWith(ticket.jti, expect.any(Number));
  });
});
