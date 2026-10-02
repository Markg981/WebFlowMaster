import { describe, expect, it } from 'vitest';
import { invitationMail, passwordResetMail, runFinishedMail } from './mail-messages';
describe('transactional HTML mail', () => {
  it('escapes invitation prose and keeps a plain-text fallback and safe action URL', () => {
    const message = invitationMail({ base: 'https://wfm.test', username: 'ann@shop.test', token: 'secret-token', role: 'editor', organizationName: '<img src=x onerror=alert(1)>', invitedBy: 'A&B', expiresAt: new Date('2026-10-03T10:00:00Z') });
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(message.html).toContain('A&amp;B');
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('https://wfm.test/auth?invitation=secret-token');
    expect(message.html).toContain('href="https://wfm.test/auth?invitation=secret-token&amp;username=');
  });
  it('rejects unsafe or credential-bearing public base URLs', () => {
    for (const base of ['javascript:alert(1)', 'https://user:password@wfm.test', '//wfm.test', 'https://wfm.test/?token=bad']) {
      expect(() => passwordResetMail({ base, username: 'ann@shop.test', token: 'secret', expiresAt: new Date() })).toThrow(/public URL/i);
    }
  });
  it('renders reset and run templates with escaped dynamic content', () => {
    const reset = passwordResetMail({ base: 'https://wfm.test/', username: 'ann@shop.test', token: 'secret', expiresAt: new Date() });
    expect(reset.html).toContain('Choose a new password');
    expect(reset.text).toContain('/auth?reset=secret');
    const run = runFinishedMail('qa@shop.test', { planId: 'p', executionId: 'r', planName: '<script>bad</script>', status: 'failed', totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, durationMs: 100, triggeredBy: 'manual' });
    expect(run.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(run.html).not.toContain('<script>');
  });
});
