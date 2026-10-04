import { z } from 'zod';

export const BDD_MAX_DURATION_MS = 300_000;
export const BDD_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const BDD_PROFILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const BddAgentProfileSchema = z.object({
  id: z.string().regex(BDD_PROFILE_ID), label: z.string().min(1).max(120),
  provider: z.literal('cucumber-js'), revision: z.string().min(1).max(160),
  maxDurationMs: z.number().int().min(1000).max(BDD_MAX_DURATION_MS),
}).strict();
export type BddAgentProfile = z.infer<typeof BddAgentProfileSchema>;
export const BddAgentRequestSchema = z.object({
  source: z.string().min(1).max(20 * 1024 * 1024),
  uri: z.string().min(1).max(200).refine(value => /^[a-zA-Z0-9_.-]+\.feature$/.test(value) && !value.includes('..'), 'A logical .feature filename is required'),
  scenarioLine: z.number().int().positive(), exampleLine: z.number().int().positive().optional(),
  profile: BddAgentProfileSchema.pick({ id: true, revision: true }),
  variables: z.record(z.string().max(256 * 1024)).refine(value => Object.keys(value).length <= 1000),
  timeoutMs: z.number().int().min(1000).max(BDD_MAX_DURATION_MS),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(value.source).byteLength > 20 * 1024 * 1024 || new TextEncoder().encode(JSON.stringify(value.variables)).byteLength > 1024 * 1024) {
    ctx.addIssue({code: z.ZodIssueCode.custom,message:'BDD request exceeds byte limits'});
  }
});
export type BddAgentRequest = z.infer<typeof BddAgentRequestSchema>;
export const BddStepResultSchema = z.object({
  name: z.string().max(64 * 1024), keyword: z.string().max(100).optional(),
  status: z.enum(['PASSED','FAILED','SKIPPED','PENDING','UNDEFINED','AMBIGUOUS','UNKNOWN']),
  durationMs: z.number().nonnegative().finite(), error: z.string().max(256 * 1024).optional(),
  kind: z.enum(['step','hook']),
}).strict();
export type BddStepResult = z.infer<typeof BddStepResultSchema>;
export const BddAttachmentSchema=z.object({mediaType:z.literal('text/plain'),text:z.string().max(1024*1024)}).strict();
export const BddAgentResultSchema = z.object({
  status: z.enum(['passed','failed','cancelled']), durationMs: z.number().nonnegative().finite(),
  steps: z.array(BddStepResultSchema).max(100_000), error: z.string().max(256 * 1024).optional(),
  attachments:z.array(BddAttachmentSchema).max(100).optional(),
}).strict().superRefine((value,ctx) => {
  if ((value.attachments ?? []).reduce((size,item) => size+new TextEncoder().encode(item.text).byteLength,0) > 1024*1024) ctx.addIssue({code:z.ZodIssueCode.custom,message:'BDD attachments exceed the byte budget'});
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > BDD_MAX_OUTPUT_BYTES) ctx.addIssue({code:z.ZodIssueCode.custom,message:'BDD result exceeds the output budget'});
  if (value.status === 'passed' && (!value.steps.some(step => step.kind === 'step') || value.steps.some(step => step.status !== 'PASSED'))) ctx.addIssue({code:z.ZodIssueCode.custom,message:'A passed BDD run requires all executed steps and hooks to pass'});
});
export type BddAgentResult = z.infer<typeof BddAgentResultSchema>;
