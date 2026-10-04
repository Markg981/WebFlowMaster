import { describe, it, expect } from 'vitest';
import { mailSettingsInputSchema } from '@shared/mail-settings';

describe('organization mail configuration contract', () => {
  it('supports every ready provider and installation compatibility modes', () => {
    for (const provider of ['none', 'generic', 'ses', 'sendgrid', 'mailgun']) {
      expect(mailSettingsInputSchema.safeParse({ smtpMode: 'inherit', provider, version: 0 }).success).toBe(true);
    }
    expect(mailSettingsInputSchema.safeParse({ smtpMode: 'disabled', provider: 'none', version: 0 }).success).toBe(true);
  });
  it('rejects arbitrary transport options, unsafe ports and header injection', () => {
    const base = { smtpMode: 'custom', provider: 'none', smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false, fromAddress: 'qa@example.com', version: 0 };
    expect(mailSettingsInputSchema.safeParse(base).success).toBe(true);
    expect(mailSettingsInputSchema.safeParse({ ...base, tls: { rejectUnauthorized: false } }).success).toBe(false);
    expect(mailSettingsInputSchema.safeParse({ ...base, smtpPort: 0 }).success).toBe(false);
    expect(mailSettingsInputSchema.safeParse({ ...base, fromAddress: 'qa@example.com\r\nBcc: spy@example.com' }).success).toBe(false);
  });
});
