import { z } from 'zod';
import type { TestPlanSchedule, InsertTestPlanSchedule } from '@shared/schema';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules'; // For transformApiDataToFormValues

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

export const RETRY_ON_FAILURE_OPTIONS: { value: TestPlanSchedule['retryOnFailure']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'once', label: 'Once' },
  { value: 'twice', label: 'Twice' },
];

export const RETRY_VALUES = RETRY_ON_FAILURE_OPTIONS.map(o => o.value);

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
  { value: 'edge', label: 'Edge' }, // Added from previous version seen
  { value: 'safari', label: 'Safari' }, // Added from previous version seen
] as const;

export const BROWSER_VALUES = BROWSER_OPTIONS.map(o => o.value);

// For environment, if you want a predefined list for the form, you can define it here too:
export const ENVIRONMENT_OPTIONS = [
    { value: 'QA', label: 'QA' },
    { value: 'Staging', label: 'Staging' },
    { value: 'Production', label: 'Production' },
    { value: 'Development', label: 'Development' },
] as const;

export const ENVIRONMENT_VALUES = ENVIRONMENT_OPTIONS.map(o => o.value);


export const scheduleFormSchema = z.object({
  scheduleName: z.string().min(1, 'Schedule name is required'),
  testPlanId: z.string().min(1, 'Test plan is required'),
  frequency: z.string().min(1, 'Frequency is required'),
  customCronExpression: z.string().optional(),
  nextRunAt: z.date({ required_error: 'Next run date and time is required' }),
  environment: z.string().optional(), // Free text, or use z.enum(ENVIRONMENT_OPTIONS.map(e => e.value)) if you want a select
  browsers: z.array(z.enum(BROWSER_OPTIONS.map(b => b.value) as [string, ...string[]]))
              .min(1, 'At least one browser must be selected').optional().nullable(),
  isActive: z.boolean().default(true),
  retryOnFailure: z.enum(RETRY_ON_FAILURE_OPTIONS.map(opt => opt.value) as [TestPlanSchedule['retryOnFailure'], ...TestPlanSchedule['retryOnFailure'][]]).default('none'),
  notificationConfigOverride: z.string().optional().refine((val) => {
    if (!val || val.trim() === '') return true;
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, { message: 'Must be valid JSON or empty' }),
  executionParameters: z.string().optional().refine((val) => {
    if (!val || val.trim() === '') return true;
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, { message: 'Must be valid JSON or empty' }),
}).superRefine((data, ctx) => {
  if (data.frequency === 'custom_cron' && (!data.customCronExpression || data.customCronExpression.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customCronExpression'],
      message: 'CRON expression is required for custom frequency.',
    });
  }
});

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export const transformFormValuesToApiPayload = (
  values: ScheduleFormValues
): Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt'> => {

  let effectiveFrequency = values.frequency;
  if (values.frequency === 'custom_cron' && values.customCronExpression) {
    effectiveFrequency = `cron:${values.customCronExpression}`;
  }

  return {
    scheduleName: values.scheduleName,
    testPlanId: values.testPlanId,
    frequency: effectiveFrequency,
    nextRunAt: values.nextRunAt,
    environment: values.environment || null,
    browsers: values.browsers && values.browsers.length > 0 ? values.browsers : null,
    isActive: values.isActive,
    retryOnFailure: values.retryOnFailure,
    notificationConfigOverride: values.notificationConfigOverride ? JSON.parse(values.notificationConfigOverride) : null,
    executionParameters: values.executionParameters ? JSON.parse(values.executionParameters) : null,
  };
};

export const transformApiDataToFormValues = (
  apiData: Partial<TestPlanScheduleEnhanced>
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
    nextRunAt: apiData.nextRunAt ? (apiData.nextRunAt instanceof Date ? apiData.nextRunAt : new Date(apiData.nextRunAt)) : undefined,
    environment: apiData.environment || '',
    browsers: apiData.browsers || [],
    isActive: apiData.isActive !== undefined ? apiData.isActive : true,
    retryOnFailure: apiData.retryOnFailure || 'none',
    notificationConfigOverride: apiData.notificationConfigOverride ? JSON.stringify(apiData.notificationConfigOverride, null, 2) : '',
    executionParameters: apiData.executionParameters ? JSON.stringify(apiData.executionParameters, null, 2) : '',
  };
};
