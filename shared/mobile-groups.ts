import { z } from 'zod';
import { MOBILE_PLATFORMS, mobileStepSchema, mobileStepsProblems } from './mobile';

export const mobileGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional().nullable(),
    platform: z.enum(MOBILE_PLATFORMS),
    projectId: z.number().int().positive().optional().nullable(),
    steps: z.array(mobileStepSchema).min(1).max(200),
  })
  .superRefine((group, ctx) => {
    for (const message of mobileStepsProblems(group.steps, group.platform))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message });
    if (group.steps.some((step) => step.action === 'callGroup'))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'A mobile group cannot call another group.',
      });
  });
export type MobileGroupInput = z.infer<typeof mobileGroupSchema>;
export type MobileGroupDefinition = MobileGroupInput & { id: string };
