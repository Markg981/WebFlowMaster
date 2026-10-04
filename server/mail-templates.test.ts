import { describe, it, expect } from 'vitest';
import { applyMailTemplate, builtInTemplates, renderMailTemplate } from './mail-templates';
import { privilegedDb } from './db';
import { mailTemplates } from '@shared/mail-templates';
import { createTestOrganization } from './tests/factories';
import { runWithTenant } from './middleware/tenancy';
import { passwordResetMail } from './mail-messages';

const variables = { username: '<img src=x onerror=alert(1)>', expiresAt: 'tomorrow', actionUrl: 'https://example.test/auth?reset=synthetic&username=ann' };
describe('safe mail templates', () => {
  it('escapes values and preserves required action links', () => {
    const rendered = renderMailTemplate('password_reset', builtInTemplates.password_reset, variables);
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).toContain('href="https://example.test/auth?reset=synthetic&amp;username=ann"');
    expect(rendered.text).toContain(variables.actionUrl);
  });
  it('rejects wrong variables, executable expressions, subject injection and unsafe attribute contexts', () => {
    for (const edit of [{ subject: '{{organizationName}}' }, { text: '{{username.toUpperCase()}}' }, { subject: 'hello\r\nBcc: attacker' }, { html: '<p style="color:{{username}}">x</p><a href="{{actionUrl}}">Reset</a>' }, { html: '<a href="https://evil.test/?token={{actionUrl}}">Reset</a>' }]) {
      expect(() => renderMailTemplate('password_reset', { ...builtInTemplates.password_reset, ...edit }, variables)).toThrow();
    }
    expect(() => renderMailTemplate('password_reset', builtInTemplates.password_reset, { ...variables, actionUrl: 'javascript:alert(1)' })).toThrow();
  });
  it('sanitizes HTML, CSS and URLs and requires usable HTML and text links', () => {
    const template = { ...builtInTemplates.password_reset, html: '<script>alert(1)</script><form><input></form><img src="https://tracker.test/p"><p onclick="x" style="position:fixed;background:url(https://tracker.test)">Hi {{username}}</p><a href="javascript:alert(1)">bad</a><a href="{{actionUrl}}">Reset</a>' };
    const rendered = renderMailTemplate('password_reset', template, variables);
    expect(rendered.html).not.toMatch(/<(script|form|input|img)\b|onclick|position|url\(|javascript/);
    expect(() => renderMailTemplate('password_reset', { ...template, html: '<p>{{actionUrl}}</p>' }, variables)).toThrow();
    expect(() => renderMailTemplate('password_reset', { ...template, text: 'no link' }, variables)).toThrow();
  });
  it('uses the message organization instead of ambient request identity and preserves missing/invalid overrides', async () => {
    const organizationId = await createTestOrganization(); const foreignId = await createTestOrganization();
    const message = passwordResetMail({ base: 'https://example.test', token: 'real-secret', username: 'ann@example.test', expiresAt: new Date('2030-01-01'), organizationId });
    expect(await applyMailTemplate(message)).toEqual(message);
    await privilegedDb.insert(mailTemplates).values({ organizationId, purpose: 'password_reset', ...builtInTemplates.password_reset, subject: 'Custom {{username}}' });
    const rendered = await runWithTenant(foreignId, () => applyMailTemplate(message), { role: 'viewer' });
    expect(rendered.subject).toBe('Custom ann@example.test'); expect(rendered.text).toContain('real-secret');
    expect(await applyMailTemplate({ ...message, organizationId: foreignId })).toEqual({ ...message, organizationId: foreignId });
    expect(await applyMailTemplate({ ...message, purpose: 'other' })).toEqual({ ...message, purpose: 'other' });
    await privilegedDb.update(mailTemplates).set({ subject: '{{notAllowed}}' });
    expect(await applyMailTemplate(message)).toEqual(message);
  });
});
