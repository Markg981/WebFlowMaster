import React, { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { fetchTestPlansAPI, type TestPlanSummary } from '@/lib/api/test-plans';
import {
  scheduleFormSchema,
  type ScheduleFormValues,
  FREQUENCY_OPTIONS,
  RETRY_ON_FAILURE_OPTIONS,
  BROWSER_OPTIONS,
  transformFormValuesToApiPayload,
  transformApiDataToFormValues,
} from '@/lib/schemas/scheduleFormSchema';
import type { CreateScheduleClientPayload, TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface ScheduleFormProps {
  initialData?: Partial<TestPlanScheduleEnhanced>; // For editing
  onSubmit: (data: CreateScheduleClientPayload | Partial<CreateScheduleClientPayload>) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

const ScheduleForm: React.FC<ScheduleFormProps> = ({ initialData, onSubmit, onCancel, isSubmitting }) => {
  const isEditMode = Boolean(initialData && initialData.id);

  const transformedInitialData = useMemo(() => {
    return initialData ? transformApiDataToFormValues(initialData) : {};
  }, [initialData]);

  const {
    control,
    handleSubmit,
    register,
    watch,
    reset,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: transformedInitialData || {
      scheduleName: '',
      testPlanId: '',
      frequency: FREQUENCY_OPTIONS[0].value,
      customCronExpression: '',
      nextRunAt: new Date(),
      environment: '',
      browsers: [BROWSER_OPTIONS[0].value],
      isActive: true,
      retryOnFailure: 'none',
      notificationConfigOverride: '',
      executionParameters: '',
    },
  });

  useEffect(() => {
    if (initialData) {
      reset(transformApiDataToFormValues(initialData));
    } else {
      reset({
        scheduleName: '',
        testPlanId: '',
        frequency: FREQUENCY_OPTIONS[0].value,
        customCronExpression: '',
        nextRunAt: new Date(),
        environment: '',
        browsers: [BROWSER_OPTIONS[0].value],
        isActive: true,
        retryOnFailure: 'none',
        notificationConfigOverride: '',
        executionParameters: '',
      });
    }
  }, [initialData, reset]);

  const { data: testPlans, isLoading: isLoadingTestPlans } = useQuery<TestPlanSummary[], Error>({
    queryKey: ['testPlansSummary'],
    queryFn: fetchTestPlansAPI,
  });

  const watchedFrequency = watch('frequency');

  const handleFormSubmit = async (values: ScheduleFormValues) => {
    const apiPayload = transformFormValuesToApiPayload(values);
    await onSubmit(apiPayload as any); // Type assertion needed due to Omit differences
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      <div>
        <Label htmlFor="scheduleName">Schedule Name</Label>
        <Input id="scheduleName" {...register('scheduleName')} />
        {errors.scheduleName && <p className="text-sm text-red-500 mt-1">{errors.scheduleName.message}</p>}
      </div>

      <div>
        <Label htmlFor="testPlanId">Test Plan</Label>
        <Controller
          name="testPlanId"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingTestPlans}>
              <SelectTrigger>
                <SelectValue placeholder="Select a test plan..." />
              </SelectTrigger>
              <SelectContent>
                {isLoadingTestPlans ? (
                  <SelectItem value="loading" disabled>Loading test plans...</SelectItem>
                ) : (
                  testPlans?.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
        />
        {errors.testPlanId && <p className="text-sm text-red-500 mt-1">{errors.testPlanId.message}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="frequency">Frequency</Label>
          <Controller
            name="frequency"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select frequency..." />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.frequency && <p className="text-sm text-red-500 mt-1">{errors.frequency.message}</p>}
        </div>

        {watchedFrequency === 'custom_cron' && (
          <div>
            <Label htmlFor="customCronExpression">CRON Expression
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" type="button" className="ml-1 h-5 w-5">
                                <InfoCircledIcon className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent className="w-60">
                            <p className="text-xs">
                                Uses standard CRON format (minute, hour, day of month, month, day of week).
                                Example: "0 2 * * *" for 2 AM daily.
                                Use UTC time.
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </Label>
            <Input id="customCronExpression" {...register('customCronExpression')} placeholder="e.g., 0 0 * * *" />
            {errors.customCronExpression && <p className="text-sm text-red-500 mt-1">{errors.customCronExpression.message}</p>}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="nextRunAt">Next Run At (UTC)</Label>
        <Controller
          name="nextRunAt"
          control={control}
          render={({ field }) => (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !field.value && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {field.value ? format(field.value, 'PPP HH:mm') : <span>Pick a date and time</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={field.value}
                  onSelect={(date) => {
                    // Preserve time if only date is changed, or set to current time if new date
                    const newDate = date || new Date();
                    const currentTime = field.value || new Date();
                    newDate.setHours(currentTime.getHours());
                    newDate.setMinutes(currentTime.getMinutes());
                    newDate.setSeconds(currentTime.getSeconds());
                    field.onChange(newDate);
                  }}
                  initialFocus
                />
                <div className="p-3 border-t border-border">
                    <Label htmlFor="time">Time (UTC)</Label>
                    <Input
                        type="time"
                        id="time"
                        value={field.value ? format(field.value, 'HH:mm') : ''}
                        onChange={(e) => {
                            const newTime = e.target.value;
                            const [hours, minutes] = newTime.split(':').map(Number);
                            const newDate = field.value ? new Date(field.value) : new Date();
                            newDate.setUTCHours(hours); // Assuming input is UTC
                            newDate.setUTCMinutes(minutes);
                            field.onChange(newDate);
                        }}
                    />
                </div>
              </PopoverContent>
            </Popover>
          )}
        />
        {errors.nextRunAt && <p className="text-sm text-red-500 mt-1">{errors.nextRunAt.message}</p>}
      </div>

      <div>
        <Label htmlFor="environment">Environment</Label>
        <Input id="environment" {...register('environment')} placeholder="e.g., QA, Staging, Production" />
        {errors.environment && <p className="text-sm text-red-500 mt-1">{errors.environment.message}</p>}
      </div>

      <div>
        <Label>Browsers</Label>
        <Controller
            name="browsers"
            control={control}
            render={({ field }) => (
                <div className="space-y-2 mt-1">
                    {BROWSER_OPTIONS.map((option) => (
                        <div key={option.value} className="flex items-center space-x-2">
                            <Checkbox
                                id={`browser-${option.value}`}
                                checked={field.value?.includes(option.value) || false}
                                onCheckedChange={(checked) => {
                                    const currentBrowsers = field.value || [];
                                    if (checked) {
                                        field.onChange([...currentBrowsers, option.value]);
                                    } else {
                                        field.onChange(currentBrowsers.filter(b => b !== option.value));
                                    }
                                }}
                            />
                            <Label htmlFor={`browser-${option.value}`} className="font-normal">{option.label}</Label>
                        </div>
                    ))}
                </div>
            )}
        />
        {errors.browsers && <p className="text-sm text-red-500 mt-1">{errors.browsers.message}</p>}
      </div>

      <div>
        <Label htmlFor="retryOnFailure">Retry on Failure</Label>
        <Controller
          name="retryOnFailure"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger>
                <SelectValue placeholder="Select retry behavior..." />
              </SelectTrigger>
              <SelectContent>
                {RETRY_ON_FAILURE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.retryOnFailure && <p className="text-sm text-red-500 mt-1">{errors.retryOnFailure.message}</p>}
      </div>

      <div>
        <Label htmlFor="notificationConfigOverride">Notification Overrides (JSON)
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" type="button" className="ml-1 h-5 w-5">
                            <InfoCircledIcon className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent className="w-80">
                        <p className="text-xs">
                            Optional. Override plan-level notifications. Example:
                            <pre>{`{\n  "emails": ["user@example.com"],\n  "onSuccess": true,\n  "onFailure": true\n}`}</pre>
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </Label>
        <Textarea
          id="notificationConfigOverride"
          {...register('notificationConfigOverride')}
          rows={3}
          placeholder='e.g., { "emails": ["test@example.com"], "onSuccess": true }'
        />
        {errors.notificationConfigOverride && <p className="text-sm text-red-500 mt-1">{errors.notificationConfigOverride.message}</p>}
      </div>

      <div>
        <Label htmlFor="executionParameters">Execution Parameters (JSON)
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" type="button" className="ml-1 h-5 w-5">
                            <InfoCircledIcon className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent className="w-80">
                        <p className="text-xs">
                            Optional. JSON object of parameters to inject into the execution. Example:
                            <pre>{`{\n  "customVar": "value",\n  "anotherVar": 123\n}`}</pre>
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </Label>
        <Textarea
          id="executionParameters"
          {...register('executionParameters')}
          rows={3}
          placeholder='e.g., { "param1": "value1", "param2": true }'
        />
        {errors.executionParameters && <p className="text-sm text-red-500 mt-1">{errors.executionParameters.message}</p>}
      </div>

      <div className="flex items-center space-x-2">
        <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
                <Checkbox
                    id="isActive"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                />
            )}
        />
        <Label htmlFor="isActive" className="font-normal">Schedule Active</Label>
        {errors.isActive && <p className="text-sm text-red-500 mt-1">{errors.isActive.message}</p>}
      </div>

      <div className="flex justify-end space-x-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || isLoadingTestPlans}>
          {isSubmitting ? 'Saving...' : (isEditMode ? 'Save Changes' : 'Create Schedule')}
        </Button>
      </div>
    </form>
  );
};

export default ScheduleForm;
