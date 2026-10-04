import { z } from 'zod';
import { PROTOCOL_HARD_LIMITS } from './api-protocol-config';

const json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(json)]),
);
export const ConversationStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send'), message: json }).strict(),
  z
    .object({
      type: z.literal('receive'),
      timeoutMs: z.number().int().min(1).max(60_000).optional(),
      property: z.string().max(512).optional(),
      equals: json.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('capture'),
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
      property: z.string().max(512).optional(),
    })
    .strict(),
  z.object({ type: z.literal('end') }).strict(),
]);
export const ConversationPlanSchema = z
  .object({ steps: z.array(ConversationStepSchema).min(1).max(PROTOCOL_HARD_LIMITS.maxSteps) })
  .strict()
  .superRefine((plan, ctx) => {
    let received = false;
    let ended = false;
    plan.steps.forEach((step, index) => {
      if ((step.type === 'send' || step.type === 'end') && ended)
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index],
          message: 'Cannot send or end after end.',
        });
      if (step.type === 'capture' && !received)
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index],
          message: 'Capture requires a preceding receive.',
        });
      if (step.type === 'receive') received = true;
      if (step.type === 'send' || step.type === 'end') received = false;
      if (step.type === 'end') ended = true;
    });
  });
export type ConversationPlan = z.infer<typeof ConversationPlanSchema>;
export function readConversationPlan(body: string): ConversationPlan | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, 'steps'))
    return ConversationPlanSchema.parse(value);
  return undefined;
}
