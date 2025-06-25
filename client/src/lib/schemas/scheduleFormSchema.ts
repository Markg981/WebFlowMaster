import { z } from 'zod';

export const محیط‌های_موجود = ['Staging', 'QA', 'Production', 'Development'] as const;
export const مرورگرهای_موجود = ['chromium', 'firefox', 'webkit', 'edge', 'safari'] as const; // Expanded list
export const فرکانس‌های_موجود = ['once', 'daily', 'weekly', 'monthly', 'custom_cron'] as const;
export const روزهای_هفته_موجود = [
  { id: '0', label: 'Sunday' }, // Sunday is 0 in cron
  { id: '1', label: 'Monday' },
  { id: '2', label: 'Tuesday' },
  { id: '3', label: 'Wednesday' },
  { id: '4', label: 'Thursday' },
  { id: '5', label: 'Friday' },
  { id: '6', label: 'Saturday' },
] as const;
export const حالات_تلاش_مجدد_موجود = ['none', 'once', 'twice'] as const;


export const scheduleFormSchema = z.object({
  id: z.string().optional(), // Present if editing
  testPlanId: z.string().min(1, "Test Plan is required."),
  scheduleName: z.string().min(3, "Schedule Name must be at least 3 characters."),
  environment: z.enum(محیط‌های_موجود).optional().nullable(),
  browsers: z.array(z.enum(مرورگرهای_موجود)).min(1, "At least one browser must be selected.").optional().nullable(),

  frequency: z.enum(فرکانس‌های_موجود),

  // Specific timing fields based on frequency
  nextRunAtOnce: z.date().optional(), // For 'once'
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(), // For 'daily'
  weeklyDay: z.string().optional(), // For 'weekly' (e.g., '1' for Monday)
  weeklyTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(), // For 'weekly'
  monthlyDate: z.number().int().min(1).max(31).optional(), // For 'monthly' (1-31)
  monthlyTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(), // For 'monthly'
  customCronExpression: z.string().optional(), // For 'custom_cron'

  // This will be the computed nextRunAt (timestamp or Date) to be sent to backend
  // It's not directly part of the form input but derived.
  // Actual `nextRunAt` (Date or number) will be constructed before sending to API.

  notificationConfigOverride: z.object({
    emails: z.string().optional().nullable(), // Comma-separated emails
    slackChannels: z.string().optional().nullable(), // Comma-separated channels
    onSuccess: z.boolean().default(false),
    onFailure: z.boolean().default(true),
    onStart: z.boolean().default(false),
  }).optional().nullable(),

  executionParameters: z.string().optional().refine(
    (val) => {
      if (!val || val.trim() === "") return true; // Allow empty string
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Execution Parameters must be valid JSON or empty." }
  ).nullable(),

  isActive: z.boolean().default(true),
  retryOnFailure: z.enum(حالات_تلاش_مجدد_موجود).default('none'),
})
.superRefine((data, ctx) => {
  // Conditional validation based on frequency
  if (data.frequency === 'once' && !data.nextRunAtOnce) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date/Time for 'once' schedule is required.", path: ['nextRunAtOnce'] });
  }
  if (data.frequency === 'daily' && !data.dailyTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Time for 'daily' schedule is required.", path: ['dailyTime'] });
  }
  if (data.frequency === 'weekly') {
    if (!data.weeklyDay) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Day for 'weekly' schedule is required.", path: ['weeklyDay'] });
    }
    if (!data.weeklyTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Time for 'weekly' schedule is required.", path: ['weeklyTime'] });
    }
  }
  if (data.frequency === 'monthly') {
    if (!data.monthlyDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date for 'monthly' schedule is required.", path: ['monthlyDate'] });
    }
    if (!data.monthlyTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Time for 'monthly' schedule is required.", path: ['monthlyTime'] });
    }
  }
  if (data.frequency === 'custom_cron' && (!data.customCronExpression || data.customCronExpression.trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cron expression for 'custom_cron' schedule is required.", path: ['customCronExpression'] });
  }
  // TODO: Add cron expression validation if possible (e.g. using a library)
});

export type ScheduleFormData = z.infer<typeof scheduleFormSchema>;

// Helper function to derive the actual nextRunAt and simplified frequency string for the backend
export const prepareSchedulePayload = (formData: ScheduleFormData): CreateSchedulePayload | UpdateSchedulePayload => {
  const {
    nextRunAtOnce, dailyTime, weeklyDay, weeklyTime, monthlyDate, monthlyTime, customCronExpression,
    ...restOfData
  } = formData;

  let effectiveNextRunAt: Date | number;
  let backendFrequency = formData.frequency; // Start with the selected frequency type

  const now = new Date();

  switch (formData.frequency) {
    case 'once':
      if (!formData.nextRunAtOnce) throw new Error("Date for 'once' schedule is missing");
      effectiveNextRunAt = formData.nextRunAtOnce;
      break;
    case 'daily':
      if (!formData.dailyTime) throw new Error("Time for 'daily' schedule is missing");
      const [dailyH, dailyM] = formData.dailyTime.split(':').map(Number);
      effectiveNextRunAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dailyH, dailyM);
      if (effectiveNextRunAt < now) effectiveNextRunAt.setDate(effectiveNextRunAt.getDate() + 1);
      // Backend might just use 'daily' and the server scheduler calculates next based on current time + dailyTime
      // Or, backend could expect 'daily@HH:MM'
      backendFrequency = `daily@${formData.dailyTime}`; // Example of a more specific frequency for backend
      break;
    case 'weekly':
      if (!formData.weeklyDay || !formData.weeklyTime) throw new Error("Day or Time for 'weekly' schedule is missing");
      const [weeklyH, weeklyM] = formData.weeklyTime.split(':').map(Number);
      effectiveNextRunAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), weeklyH, weeklyM);
      effectiveNextRunAt.setDate(effectiveNextRunAt.getDate() + ( (parseInt(formData.weeklyDay) - effectiveNextRunAt.getDay() + 7) % 7) );
      if (effectiveNextRunAt < now) effectiveNextRunAt.setDate(effectiveNextRunAt.getDate() + 7);
      backendFrequency = `weekly@${formData.weeklyDay},${formData.weeklyTime}`;
      break;
    case 'monthly':
        if (!formData.monthlyDate || !formData.monthlyTime) throw new Error("Date or Time for 'monthly' schedule is missing");
        const [monthlyH, monthlyM] = formData.monthlyTime.split(':').map(Number);
        effectiveNextRunAt = new Date(now.getFullYear(), now.getMonth(), formData.monthlyDate, monthlyH, monthlyM);
        if (effectiveNextRunAt < now) effectiveNextRunAt.setMonth(effectiveNextRunAt.getMonth() + 1);
        // This simple logic might not handle all edge cases for months with fewer days.
        // Server-side cron calculation is more robust.
        backendFrequency = `monthly@${formData.monthlyDate},${formData.monthlyTime}`;
        break;
    case 'custom_cron':
      if (!formData.customCronExpression) throw new Error("Cron expression is missing");
      // For custom_cron, nextRunAt might be determined by the server based on the cron expression.
      // Sending Date.now() or a very near future time might be a convention.
      // Or, the server's `frequencyToCronPattern` will just use the cron string.
      effectiveNextRunAt = new Date(); // Placeholder, server will use cron string.
      backendFrequency = `cron:${formData.customCronExpression}`;
      break;
    default:
      throw new Error("Invalid frequency type");
  }

  const payloadBase = {
    ...restOfData,
    frequency: backendFrequency, // Send the potentially modified frequency string
    nextRunAt: Math.floor(effectiveNextRunAt.getTime() / 1000), // Always send as timestamp
    // Ensure JSON fields are structured as expected by API (arrays/objects)
    // The API client function `createSchedule/updateSchedule` will handle stringification if server expects strings
    browsers: formData.browsers || null,
    notificationConfigOverride: formData.notificationConfigOverride || null,
    executionParameters: formData.executionParameters ? JSON.parse(formData.executionParameters) : null,
  };

  if (formData.id) { // This is an update
    return { id: formData.id, ...payloadBase } as UpdateSchedulePayload;
  } else { // This is a create
    return payloadBase as CreateSchedulePayload;
  }
};

export const parseBackendScheduleToFormData = (schedule: TestPlanSchedule): Partial<ScheduleFormData> => {
  const baseFormData: Partial<ScheduleFormData> = {
    id: schedule.id,
    testPlanId: schedule.testPlanId,
    scheduleName: schedule.scheduleName,
    environment: schedule.environment as any || undefined,
    browsers: schedule.browsers ? (typeof schedule.browsers === 'string' ? JSON.parse(schedule.browsers) : schedule.browsers) : [],
    isActive: schedule.isActive,
    retryOnFailure: schedule.retryOnFailure as any,
    notificationConfigOverride: schedule.notificationConfigOverride ? (typeof schedule.notificationConfigOverride === 'string' ? JSON.parse(schedule.notificationConfigOverride) : schedule.notificationConfigOverride) : undefined,
    executionParameters: schedule.executionParameters ? (typeof schedule.executionParameters === 'string' ? JSON.stringify(JSON.parse(schedule.executionParameters), null, 2) : JSON.stringify(schedule.executionParameters, null, 2)) : undefined,
  };

  const freq = schedule.frequency;
  if (freq.startsWith('cron:')) {
    baseFormData.frequency = 'custom_cron';
    baseFormData.customCronExpression = freq.substring(5);
  } else if (freq.startsWith('daily@')) {
    baseFormData.frequency = 'daily';
    baseFormData.dailyTime = freq.substring(6);
  } else if (freq.startsWith('weekly@')) {
    baseFormData.frequency = 'weekly';
    const parts = freq.substring(7).split(',');
    baseFormData.weeklyDay = parts[0];
    baseFormData.weeklyTime = parts[1];
  } else if (freq.startsWith('monthly@')) {
    baseFormData.frequency = 'monthly';
    const parts = freq.substring(8).split(',');
    baseFormData.monthlyDate = parseInt(parts[0]);
    baseFormData.monthlyTime = parts[1];
  } else if (freq === 'once') {
    baseFormData.frequency = 'once';
    baseFormData.nextRunAtOnce = new Date(schedule.nextRunAt * 1000);
  } else {
    // Fallback for simple frequency types if server stores them as 'daily', 'weekly'
     baseFormData.frequency = freq as any; // Could be 'daily', 'weekly', 'monthly'
     if (schedule.nextRunAt) { // Try to infer time parts if possible
        const nextRunDate = new Date(schedule.nextRunAt * 1000);
        const timeString = `${String(nextRunDate.getHours()).padStart(2, '0')}:${String(nextRunDate.getMinutes()).padStart(2, '0')}`;
        if (freq === 'daily') baseFormData.dailyTime = timeString;
        else if (freq === 'weekly') {
            baseFormData.weeklyDay = String(nextRunDate.getDay());
            baseFormData.weeklyTime = timeString;
        } else if (freq === 'monthly') {
            baseFormData.monthlyDate = nextRunDate.getDate();
            baseFormData.monthlyTime = timeString;
        }
     }
  }
  return baseFormData;
};
