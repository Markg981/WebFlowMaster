import type { MailMessage } from './mailer';
import { summaryLine, type RunSummary } from './notifications';
import { reportUrlFor } from './report-links';

/**
 * Transactional HTML templates with equivalent plain text for every mail client.
 */

const when = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
function safeBase(base: string) {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('Invalid public URL for email'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid public URL for email');
  return url.toString().replace(/\/+$/, '');
}
function htmlMail(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  if (action) safeBase(action.url.split('?')[0]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212f"><main style="max-width:600px;margin:32px auto;padding:32px;background:white;border-radius:12px"><p style="font-weight:bold;color:#2563eb">WebFlowMaster</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${paragraphs.map(text => `<p style="line-height:1.6">${escapeHtml(text)}</p>`).join('')}${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:white;text-decoration:none;border-radius:6px">${escapeHtml(action.label)}</a></p><p style="font-size:12px;word-break:break-all">${escapeHtml(action.url)}</p>` : ''}</main></body></html>`;
}

/** The links the sign-in page understands — the same ones the Members card shows an owner. */
export function invitationLinkFor(base: string, token: string, username: string): string {
  return `${safeBase(base)}/auth?${new URLSearchParams({ invitation: token, username }).toString()}`;
}

export function passwordResetLinkFor(base: string, token: string, username: string): string {
  return `${safeBase(base)}/auth?${new URLSearchParams({ reset: token, username }).toString()}`;
}

export function invitationMail(input: { base: string; username: string; token: string; role: string; organizationName: string; invitedBy: string; expiresAt: Date; organizationId?: number }): MailMessage {
  const introduction = `${input.invitedBy} invited you to join ${input.organizationName} on WebFlowMaster as ${input.role}.`;
  const expiry = `The link works once, until ${when(input.expiresAt)}. If you were not expecting it, ignore this message.`;
  const link = invitationLinkFor(input.base, input.token, input.username);
  return {
    organizationId: input.organizationId,
    purpose: 'invitation',
    to: input.username,
    subject: `You are invited to ${input.organizationName.replace(/[\r\n]/g, ' ')} on WebFlowMaster`,
    html: htmlMail('You are invited', [introduction, expiry], { label: 'Create your account', url: link }),
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

export function passwordResetMail(input: { base: string; username: string; token: string; expiresAt: Date; organizationId?: number }): MailMessage {
  const link = passwordResetLinkFor(input.base, input.token, input.username);
  return {
    organizationId: input.organizationId,
    purpose: 'password_reset',
    to: input.username,
    subject: 'Choose a new WebFlowMaster password',
    html: htmlMail('Choose a new password', [
      `A link to choose a new password was requested for ${input.username}.`,
      `The link works once, until ${when(input.expiresAt)}. Your current password keeps working until you use it.`,
      'If you did not ask for this, ignore this message; nobody can use the link without this mailbox.',
    ], { label: 'Choose a new password', url: link }),
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

export function runFinishedMail(to: string, summary: RunSummary, organizationId?: number | null): MailMessage {
  const proposedLink = reportUrlFor(summary.planId, summary.executionId);
  let link: string | undefined;
  if (proposedLink) {
    try { safeBase(proposedLink); link = proposedLink; } catch { /* An invalid operator public URL must never become an HTML action. */ }
  }
  return {
    organizationId,
    purpose: 'run_finished',
    to,
    subject: `[WebFlowMaster] ${summary.planName.replace(/[\r\n]/g, ' ')}: ${summary.status === 'completed' ? 'passed' : summary.status}`,
    html: htmlMail('Your run has finished', [summaryLine(summary), "You receive this because of your notification settings, or the plan's."], link ? { label: 'View report', url: link } : undefined),
    text: [summaryLine(summary), '', ...(link ? ['Report:', link, ''] : []), 'You receive this because of your notification settings, or the plan\'s.'].join('\n'),
  };
}
