import sanitizeHtml from 'sanitize-html';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import type { MailMessage } from './mailer';
import { mailTemplates, TEMPLATE_PURPOSES, TEMPLATE_VARIABLES, type MailTemplateContent, type TemplatePurpose } from '@shared/mail-templates';

export const builtInTemplates: Record<TemplatePurpose, MailTemplateContent> = {
  invitation: { subject: 'You are invited to {{organizationName}} on WebFlowMaster', html: '<h1>You are invited</h1><p>{{invitedBy}} invited you to join {{organizationName}} on WebFlowMaster as {{role}}.</p><p>The link works once, until {{expiresAt}}.</p><p><a href="{{actionUrl}}">Create your account</a></p>', text: '{{invitedBy}} invited you to join {{organizationName}} on WebFlowMaster as {{role}}.\nThe link works once, until {{expiresAt}}.\nCreate your account: {{actionUrl}}' },
  password_reset: { subject: 'Choose a new WebFlowMaster password', html: '<h1>Choose a new password</h1><p>A link to choose a new password was requested for {{username}}.</p><p>The link works once, until {{expiresAt}}. Your current password keeps working until you use it.</p><p><a href="{{actionUrl}}">Choose a new password</a></p><p>If you did not ask for this, ignore this message.</p>', text: 'A link to choose a new password was requested for {{username}}.\n{{actionUrl}}\nThe link works once, until {{expiresAt}}. Your current password keeps working until you use it.\nIf you did not ask for this, ignore this message.' },
  run_finished: { subject: '[WebFlowMaster] {{planName}}: {{status}}', html: '<h1>Your run has finished</h1><p>{{summary}}</p><p><a href="{{actionUrl}}">View report</a></p><p>You receive this because of your notification settings, or the plan\'s.</p>', text: '{{summary}}\nReport: {{actionUrl}}\nYou receive this because of your notification settings, or the plan\'s.' },
};
export function syntheticTemplateVariables(purpose: TemplatePurpose): Record<string, string> {
  const all = { username: 'alex@example.test', organizationName: 'Example organization', invitedBy: 'Example owner', role: 'editor', expiresAt: '2030-01-01 12:00 UTC', actionUrl: 'https://example.test/auth?token=synthetic-preview', planName: 'Example plan', status: 'passed', summary: 'Example plan: 3 tests passed, 0 failed.' };
  return Object.fromEntries(TEMPLATE_VARIABLES[purpose].map(key => [key, all[key as keyof typeof all]]));
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const marker = /{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g;
function sanitize(source: string): string {
  return sanitizeHtml(source, {
    allowedTags: ['p', 'br', 'div', 'span', 'main', 'h1', 'h2', 'h3', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'td', 'th', 'a', 'hr'],
    allowedAttributes: { '*': ['style'], a: ['href'] }, allowedSchemes: ['https', 'http'], allowProtocolRelative: false,
    allowedStyles: { '*': { color: [/^(#[0-9a-f]{3,8}|[a-z]+)$/i], 'background-color': [/^(#[0-9a-f]{3,8}|[a-z]+)$/i], 'font-size': [/^\d{1,3}(px|em|%)$/], 'font-weight': [/^(normal|bold|[1-9]00)$/], 'text-align': [/^(left|center|right)$/], 'text-decoration': [/^(none|underline)$/], padding: [/^[\d\s.pxem%]+$/], margin: [/^[\d\s.pxem%]+$/], 'line-height': [/^[\d.]+$/] } },
    transformTags: { '*': (tagName, attribs) => {
      for (const [key, value] of Object.entries(attribs)) {
        if (value.includes('{{') && !(tagName === 'a' && key === 'href' && value === '{{actionUrl}}')) throw new Error('Variables are only allowed in text or action-link href');
      }
      return { tagName, attribs };
    } },
  });
}
export function renderMailTemplate(purpose: TemplatePurpose, template: MailTemplateContent, variables: Record<string, string>): MailTemplateContent {
  if (!TEMPLATE_PURPOSES.includes(purpose)) throw new Error('Invalid template purpose');
  if (!template.subject.trim() || !template.text.trim() || !template.html.trim() || template.subject.length > 254 || template.html.length > 50000 || template.text.length > 20000 || /[\r\n]/.test(template.subject)) throw new Error('Invalid template size or subject');
  for (const source of [template.subject, template.html, template.text]) {
    const leftover = source.replace(marker, (_match, name: string) => {
      if (!TEMPLATE_VARIABLES[purpose].includes(name) || typeof variables[name] !== 'string') throw new Error('Unsupported template variable');
      return '';
    });
    if (leftover.includes('{{') || leftover.includes('}}')) throw new Error('Invalid template expression');
  }
  const actionUrl = variables.actionUrl;
  if (actionUrl) { const url = new URL(actionUrl); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\r\n]/.test(actionUrl)) throw new Error('Invalid action URL'); }
  const clean = sanitize(template.html);
  if (!clean.trim()) throw new Error('Empty sanitized template');
  if (purpose !== 'run_finished' && (!actionUrl || !/<a\b[^>]*href="{{actionUrl}}"[^>]*>[^<\s][\s\S]*?<\/a>/i.test(clean) || !/{{\s*actionUrl\s*}}/.test(template.text))) throw new Error('Required action link is missing');
  const interpolate = (source: string, html: boolean) => source.replace(marker, (_match, name: string) => html ? escapeHtml(variables[name]) : variables[name]);
  const subject = interpolate(template.subject, false);
  if (/[\r\n]/.test(subject)) throw new Error('Invalid rendered subject');
  return { subject, html: sanitize(interpolate(clean, true)), text: interpolate(template.text, false) };
}
export function validateMailTemplate(purpose: TemplatePurpose, template: MailTemplateContent): MailTemplateContent {
  renderMailTemplate(purpose, template, syntheticTemplateVariables(purpose));
  return { ...template, html: sanitize(template.html) };
}
/** A preview has identical rendered content, but its synthetic actions cannot navigate. */
export function previewMailTemplate(purpose: TemplatePurpose, template: MailTemplateContent): MailTemplateContent {
  const rendered = renderMailTemplate(purpose, template, syntheticTemplateVariables(purpose));
  return { ...rendered, html: sanitizeHtml(rendered.html, {
    allowedTags: false, allowedAttributes: { '*': ['style'], a: ['title'] },
    transformTags: { a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...(attributes.style ? { style: attributes.style } : {}), ...(attributes.href ? { title: attributes.href } : {}) } }) },
  }) };
}
/** Privileged lookup is deliberate: reset and worker sends have no owner request context. */
export async function applyMailTemplate(message: MailMessage): Promise<MailMessage> {
  if (!Number.isInteger(message.organizationId) || !message.organizationId || !TEMPLATE_PURPOSES.includes(message.purpose as TemplatePurpose)) return message;
  const [template] = await privilegedDb.select().from(mailTemplates).where(and(eq(mailTemplates.organizationId, message.organizationId!), eq(mailTemplates.purpose, message.purpose as TemplatePurpose)));
  if (!template || !template.custom) return message;
  try { return { ...message, ...renderMailTemplate(template.purpose, template, message.templateVariables ?? {}) }; }
  catch { console.warn('Organization email template could not be safely rendered', { organizationId: message.organizationId, purpose: message.purpose }); return message; }
}
