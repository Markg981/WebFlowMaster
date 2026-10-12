import { z } from 'zod';
import type { TestPlanSchedule, InsertTestPlanSchedule } from '@shared/schema';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules';

export const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'every_5_minutes', label: 'Every 5 Minutes' },
  { value: 'every_15_minutes', label: 'Every 15 Minutes' },
  { value: 'every_30_minutes', label: 'Every 30 Minutes' },
  { value: 'every_1_hours', label: 'Every 1 Hour' },
  { value: 'every_6_hours', label: 'Every 6 Hours' },
  { value: 'every_12_hours', label: 'Every 12 Hours' },
  { value: 'custom_cron', label: 'Custom CRON' },
] as const;

export const RETRY_ON_FAILURE_OPTIONS: {
  value: TestPlanSchedule['retryOnFailure'];
  label: string;
}[] = [
  { value: 'none', label: 'None' },
  { value: 'once', label: 'Once' },
  { value: 'twice', label: 'Twice' },
];

export const RETRY_VALUES = RETRY_ON_FAILURE_OPTIONS.map((o) => o.value);

export const WEEK_DAY_OPTIONS = [
  { id: '0', label: 'Sunday' },
  { id: '1', label: 'Monday' },
  { id: '2', label: 'Tuesday' },
  { id: '3', label: 'Wednesday' },
  { id: '4', label: 'Thursday' },
  { id: '5', label: 'Friday' },
  { id: '6', label: 'Saturday' },
] as const;

export const BROWSER_OPTIONS = [
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'WebKit' },
  { value: 'edge', label: 'Edge' },
  { value: 'safari', label: 'Safari' },
] as const;

export const BROWSER_VALUES = BROWSER_OPTIONS.map((o) => o.value);

// Environments are the organization's own, listed by ScheduleEnvironmentSelect. A fixed list of
// names here is what made every schedule say "QA" and load no environment at all.

/**
 * Suggestions only — the field accepts any IANA name.
 *
 * The browser's own zone leads, because it is the one the person filling the form is
 * thinking in; UTC stays available because that is what every schedule made before this
 * field existed means.
 */
export const TIMEZONE_SUGGESTIONS: string[] = Array.from(
  new Set([
    browserTimezone(),
    'UTC',
    'Europe/Rome',
    'Europe/London',
    'Europe/Zurich',
    'America/New_York',
    'America/Chicago',
    'America/Sao_Paulo',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
  ]),
);

/** The zone this browser is in, or UTC where the platform will not say. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `t(key, englishFallback)`: what react-i18next gives a component, reduced to what this needs. */
export type Translate = (key: string, fallback: string) => string;

const english: Translate = (_key, fallback) => fallback;

const emptyOrJson = (val: string | undefined) => {
  if (!val || val.trim() === '') return true;
  try {
    JSON.parse(val);
    return true;
  } catch {
    return false;
  }
};

/**
 * The form's rules, with their messages in the language the form is shown in.
 *
 * A zod schema carries its messages as plain strings, so a module-level schema can only ever
 * say "Schedule name is required" in English. The form builds its own from the `t` it has.
 */
export function buildScheduleFormSchema(t: Translate = english) {
  const invalidJson = t(
    'schedulingPage.form.validation.invalidJson',
    'Must be valid JSON or empty',
  );
  return z
    .object({
      scheduleName: z
        .string()
        .min(1, t('schedulingPage.form.validation.nameRequired', 'Schedule name is required')),
      testPlanId: z
        .string()
        .min(1, t('schedulingPage.form.validation.testPlanRequired', 'Test plan is required')),
      frequency: z
        .string()
        .min(1, t('schedulingPage.form.validation.frequencyRequired', 'Frequency is required')),
      customCronExpression: z.string().optional(),
      nextRunAt: z.date({
        required_error: t(
          'schedulingPage.form.validation.nextRunRequired',
          'Next run date and time is required',
        ),
      }),
      // IANA name. Defaults to the browser's zone rather than UTC: "02:00" means 02:00 where
      // the tester is, and making them convert it twice a year is how a nightly job ends up
      // running an hour off for half the year.
      timezone: z
        .string()
        .min(1, t('schedulingPage.form.validation.timezoneRequired', 'Timezone is required'))
        .default(browserTimezone()),
      // An environment's id, as ScheduleEnvironmentSelect saves it; a name on schedules from before.
      environment: z.string().optional(),
      browsers: z
        .array(z.enum(BROWSER_OPTIONS.map((b) => b.value) as [string, ...string[]]))
        .min(
          1,
          t(
            'schedulingPage.form.validation.browsersRequired',
            'At least one browser must be selected',
          ),
        )
        .optional()
        .nullable(),
      isActive: z.boolean().default(true),
      retryOnFailure: z
        .enum(
          RETRY_ON_FAILURE_OPTIONS.map((opt) => opt.value) as [
            TestPlanSchedule['retryOnFailure'],
            ...TestPlanSchedule['retryOnFailure'][],
          ],
        )
        .default('none'),
      notificationConfigOverride: z
        .string()
        .optional()
        .refine(emptyOrJson, { message: invalidJson }),
      executionParameters: z.string().optional().refine(emptyOrJson, { message: invalidJson }),
    })
    .superRefine((data, ctx) => {
      if (
        data.frequency === 'custom_cron' &&
        (!data.customCronExpression || data.customCronExpression.trim() === '')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customCronExpression'],
          message: t(
            'schedulingPage.form.validation.cronRequired',
            'CRON expression is required for custom frequency.',
          ),
        });
      }
    });
}

/** The rules with English messages, for code that has no `t` at hand. */
export const scheduleFormSchema = buildScheduleFormSchema();

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export const transformFormValuesToApiPayload = (
  values: ScheduleFormValues,
): Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'> => {
  let effectiveFrequency = values.frequency;
  if (values.frequency === 'custom_cron' && values.customCronExpression) {
    effectiveFrequency = `cron:${values.customCronExpression}`;
  }

  return {
    scheduleName: values.scheduleName,
    testPlanId: values.testPlanId,
    frequency: effectiveFrequency,
    nextRunAt: values.nextRunAt,
    timezone: values.timezone,
    environment: values.environment || null,
    browsers: values.browsers && values.browsers.length > 0 ? values.browsers : null,
    isActive: values.isActive,
    retryOnFailure: values.retryOnFailure,
    notificationConfigOverride: values.notificationConfigOverride
      ? JSON.parse(values.notificationConfigOverride)
      : null,
    executionParameters: values.executionParameters ? JSON.parse(values.executionParameters) : null,
  };
};

export const transformApiDataToFormValues = (
  apiData: Partial<TestPlanScheduleEnhanced>,
): Partial<ScheduleFormValues> => {
  let frequency = apiData.frequency || '';
  let customCronExpression = '';
  if (apiData.frequency?.startsWith('cron:')) {
    frequency = 'custom_cron';
    customCronExpression = apiData.frequency.substring(5);
  }

  return {
    scheduleName: apiData.scheduleName,
    testPlanId: apiData.testPlanId,
    frequency: frequency,
    customCronExpression: customCronExpression,
    nextRunAt: apiData.nextRunAt
      ? apiData.nextRunAt instanceof Date
        ? apiData.nextRunAt
        : new Date(apiData.nextRunAt)
      : undefined,
    // A saved schedule keeps the zone it was saved with — editing it must not silently
    // reinterpret its time in whatever zone the editor happens to be sitting in.
    timezone: apiData.timezone || browserTimezone(),
    environment: apiData.environment || '',
    browsers: apiData.browsers || [],
    isActive: apiData.isActive !== undefined ? apiData.isActive : true,
    retryOnFailure: apiData.retryOnFailure || 'none',
    notificationConfigOverride: apiData.notificationConfigOverride
      ? JSON.stringify(apiData.notificationConfigOverride, null, 2)
      : '',
    executionParameters: apiData.executionParameters
      ? JSON.stringify(apiData.executionParameters, null, 2)
      : '',
  };
};
