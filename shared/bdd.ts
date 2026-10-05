import { z } from 'zod';

export const BDD_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const BDD_MAX_TESTS = 2_000;
export const BDD_MAX_STEPS = 100_000;
export const BDD_MAX_PERSISTED_BYTES = 64 * 1024 * 1024;

const boundedSource = z.string().min(1).refine(value => new TextEncoder().encode(value).byteLength <= BDD_MAX_SOURCE_BYTES, 'Feature file exceeds 20 MiB.');
export const bddBindingSchema = z.object({ id: z.string().uuid(), revision: z.string().trim().min(1).max(256) }).strict();
const executionShape = { mode: z.enum(['manual', 'cucumber']), binding: bddBindingSchema.optional() };
const requireBinding = (value: { mode?: string; binding?: unknown }, context: z.RefinementCtx) => {
  if (value.mode === 'cucumber' && !value.binding) context.addIssue({ code: z.ZodIssueCode.custom, path: ['binding'], message: 'Cucumber mode requires an execution profile binding.' });
};
export const bddTestSchema = z.object({
  language: z.string().min(1).max(32), source: boundedSource,
  uri: z.string().min(1).max(200).refine(value => /^[a-zA-Z0-9_.-]+\.feature$/.test(value) && !value.includes('..'), 'A logical .feature filename is required'),
  scenarioLine: z.number().int().positive(), exampleLine: z.number().int().positive().optional(), ...executionShape,
}).strict().superRefine(requireBinding);
export const gherkinImportOptionsSchema = z.object({ mode: executionShape.mode.optional(), binding: executionShape.binding }).strict().superRefine(requireBinding);
export const BddTestSchema = bddTestSchema;
export const BddBindingSchema = bddBindingSchema;
export const GherkinImportOptionsSchema = gherkinImportOptionsSchema;
export type BddBinding = z.infer<typeof bddBindingSchema>;
export type BddTest = z.infer<typeof bddTestSchema>;
export type GherkinImportOptions = z.infer<typeof gherkinImportOptionsSchema>;
