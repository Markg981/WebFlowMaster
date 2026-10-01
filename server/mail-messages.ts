import type { MailMessage } from './mailer';
import { summaryLine, type RunSummary } from './notifications';
import { reportUrlFor } from './report-links';

/**
 * The e-mails this application sends, as plain text: they are read in every client, quoted in
 * tickets, and a link in plain text is a link everywhere.
 */

const when = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** The links the sign-in page understands — the same ones the Members card shows an owner. */
export function invitationLinkFor(base: string, token: string, username: string): string {
  return `${base}/auth?${new URLSearchParams({ invitation: token, username }).toString()}`;
}

export function passwordResetLinkFor(base: string, token: string, username: string): string {
  return `${base}/auth?${new URLSearchParams({ reset: token, username }).toString()}`;
}

export function invitationMail(input: { base: string; username: string; token: string; role: string; organizationName: string; invitedBy: string; expiresAt: Date }): MailMessage {
  return {
    to: input.username,
    subject: `You are invited to ${input.organizationName} on WebFlowMaster`,
    text: [
      `${input.invitedBy} invited you to join ${input.organizationName} on WebFlowMaster as ${input.role}.`,
      '',
      'Choose your password and create your account here:',
      invitationLinkFor(input.base, input.token, input.username),
      '',
      `The link works once, until ${when(input.expiresAt)}. If you were not expecting it, ignore this message.`,
    ].join('\n'),
  };
}

export function passwordResetMail(input: { base: string; username: string; token: string; expiresAt: Date }): MailMessage {
  return {
    to: input.username,
    subject: 'Choose a new WebFlowMaster password',
    text: [
      `A link to choose a new password was requested for ${input.username}.`,
      '',
      passwordResetLinkFor(input.base, input.token, input.username),
      '',
      `The link works once, until ${when(input.expiresAt)}. Your current password keeps working until you use it.`,
      'If you did not ask for this, ignore this message; nobody can use the link without this mailbox.',
    ].join('\n'),
  };
}

export function runFinishedMail(to: string, summary: RunSummary): MailMessage {
  const link = reportUrlFor(summary.planId, summary.executionId);
  return {
    to,
    subject: `[WebFlowMaster] ${summary.planName}: ${summary.status === 'completed' ? 'passed' : summary.status}`,
    text: [summaryLine(summary), '', ...(link ? ['Report:', link, ''] : []), 'You receive this because of your notification settings, or the plan\'s.'].join('\n'),
  };
}
