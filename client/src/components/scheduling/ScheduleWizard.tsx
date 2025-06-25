import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { scheduleFormSchema, ScheduleFormData, محیط‌های_موجود, مرورگرهای_موجود, فرکانس‌های_موجود, روزهای_هفته_موجود, حالات_تلاش_مجدد_موجود, prepareSchedulePayload, parseBackendScheduleToFormData } from '@/lib/schemas/scheduleFormSchema';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTestPlansAPI, type TestPlanSummary } from '@/lib/api/test-plans'; // Assuming TestPlanSummary is {id: string, name: string}
import { createSchedule, updateSchedule, TestPlanScheduleWithPlanName } from '@/lib/api/schedules';
import { Calendar } from "@/components/ui/calendar"; // For 'once' date
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';


interface ScheduleWizardProps {
  isOpen: boolean;
  onClose: () => void;
  testPlanId?: string; // Pre-select if provided
  scheduleToEdit?: TestPlanScheduleWithPlanName | null; // Schedule data for editing
  onScheduleSaved: () => void; // Callback after successful save
}

const ScheduleWizard: React.FC<ScheduleWizardProps> = ({ isOpen, onClose, testPlanId: initialTestPlanId, scheduleToEdit, onScheduleSaved }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 6;

  const { data: testPlansData, isLoading: isLoadingTestPlans } = useQuery<TestPlanSummary[]>({
    queryKey: ['testPlansSummary'], // Use a different key for summary data if API differs
    queryFn: fetchTestPlansAPI, // This should fetch a list of {id, name}
    enabled: isOpen, // Only fetch when the dialog is open
  });

  const defaultValues = useMemo(() => {
    if (scheduleToEdit) {
      return parseBackendScheduleToFormData(scheduleToEdit);
    }
    return {
      testPlanId: initialTestPlanId || '',
      scheduleName: '',
      environment: محیط‌های_موجود[0],
      browsers: [مرورگرهای_موجود[0]],
      frequency: فرکانس‌های_موجود[0],
      nextRunAtOnce: new Date(),
      dailyTime: '09:00',
      weeklyDay: روزهای_هفته_موجود[1].id, // Monday
      weeklyTime: '09:00',
      monthlyDate: 1,
      monthlyTime: '09:00',
      customCronExpression: '0 0 * * *',
      notificationConfigOverride: { emails: '', slackChannels: '', onSuccess: false, onFailure: true, onStart: false },
      executionParameters: '',
      isActive: true,
      retryOnFailure: حالات_تلاش_مجدد_موجود[0],
    };
  }, [scheduleToEdit, initialTestPlanId]);

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues,
    mode: 'onChange',
  });

  useEffect(() => {
    if (scheduleToEdit) {
      form.reset(parseBackendScheduleToFormData(scheduleToEdit));
    } else {
      form.reset({
        ...defaultValues,
        testPlanId: initialTestPlanId || (testPlansData && testPlansData.length > 0 ? testPlansData[0].id : ''),
      });
    }
  }, [scheduleToEdit, initialTestPlanId, form, defaultValues, testPlansData]);


  const createMutation = useMutation({
    mutationFn: createSchedule,
    onSuccess: () => {
      toast({ title: t('scheduleWizard.toast.success.createTitle'), description: t('scheduleWizard.toast.success.createDescription') });
      queryClient.invalidateQueries({ queryKey: ['testPlanSchedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedulesByPlanId', form.getValues('testPlanId')] });
      onScheduleSaved();
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: t('scheduleWizard.toast.error.createTitle'), description: error.message || t('scheduleWizard.toast.error.genericDescription'), variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string, payload: ScheduleFormData }) => updateSchedule(data.id, prepareSchedulePayload(data.payload) as any), // prepare returns Create or Update
    onSuccess: () => {
      toast({ title: t('scheduleWizard.toast.success.updateTitle'), description: t('scheduleWizard.toast.success.updateDescription') });
      queryClient.invalidateQueries({ queryKey: ['testPlanSchedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedulesByPlanId', form.getValues('testPlanId')] });
      onScheduleSaved();
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: t('scheduleWizard.toast.error.updateTitle'), description: error.message || t('scheduleWizard.toast.error.genericDescription'), variant: 'destructive' });
    },
  });

  const onSubmit = (data: ScheduleFormData) => {
    const payload = prepareSchedulePayload(data);
    if (scheduleToEdit?.id) {
      updateMutation.mutate({ id: scheduleToEdit.id, payload: data });
    } else {
      createMutation.mutate(payload as any); // prepareSchedulePayload returns CreateSchedulePayload for new
    }
  };

  const handleNext = async () => {
    // Trigger validation for the current step's fields if needed, or for all fields up to current step
    const result = await form.trigger(); // Or form.trigger(["field1", "field2"])
    if (result) { // Check specific fields based on currentStep if form.trigger() is too broad
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
    } else {
      // Optionally show a toast or highlight errors
      toast({title: t('scheduleWizard.toast.error.validationError'), description: t('scheduleWizard.toast.error.checkFields'), variant: "destructive"})
    }
  };
  const handlePrevious = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  const handleClose = () => {
    form.reset(defaultValues);
    setCurrentStep(1);
    onClose();
  };

  if (!isOpen) return null;

  const watchedFrequency = form.watch('frequency');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{scheduleToEdit ? t('scheduleWizard.editTitle') : t('scheduleWizard.createTitle')}</DialogTitle>
        </DialogHeader>

        {/* Stepper Navigation (Basic) */}
        <div className="flex justify-around items-center p-2 border-b mb-4">
            {[...Array(totalSteps)].map((_, index) => (
                <div key={index} className={`flex flex-col items-center ${currentStep === index + 1 ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 ${currentStep >= index + 1 ? 'bg-primary border-primary text-primary-foreground' : 'border-muted'}`}>
                        {index + 1}
                    </div>
                    <span className="text-xs mt-1 text-center">
                        {t(`scheduleWizard.steps.step${index + 1}.title`)}
                    </span>
                </div>
            ))}
        </div>


        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 overflow-y-auto px-1 flex-1">
          {/* Step 1: Test Plan, Name, Environment */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="testPlanId">{t('scheduleWizard.steps.step1.testPlanLabel')}</Label>
                <Controller
                  name="testPlanId"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!initialTestPlanId || isLoadingTestPlans}>
                      <SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step1.selectTestPlanPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {isLoadingTestPlans && <SelectItem value="loading" disabled>{t('scheduleWizard.loading')}</SelectItem>}
                        {testPlansData?.map(plan => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.testPlanId && <p className="text-sm text-destructive mt-1">{form.formState.errors.testPlanId.message}</p>}
              </div>
              <div>
                <Label htmlFor="scheduleName">{t('scheduleWizard.steps.step1.scheduleNameLabel')}</Label>
                <Input id="scheduleName" {...form.register('scheduleName')} />
                {form.formState.errors.scheduleName && <p className="text-sm text-destructive mt-1">{form.formState.errors.scheduleName.message}</p>}
              </div>
              <div>
                <Label htmlFor="environment">{t('scheduleWizard.steps.step1.environmentLabel')}</Label>
                <Controller
                  name="environment"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step1.selectEnvironmentPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {محیط‌های_موجود.map(env => <SelectItem key={env} value={env}>{env}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          )}

          {/* Step 2: Browsers */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <Label>{t('scheduleWizard.steps.step2.browsersLabel')}</Label>
              <Controller
                name="browsers"
                control={form.control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {مرورگرهای_موجود.map((browser) => (
                      <div key={browser} className="flex items-center space-x-2">
                        <Checkbox
                          id={`browser-${browser}`}
                          checked={field.value?.includes(browser)}
                          onCheckedChange={(checked) => {
                            const newValue = checked
                              ? [...(field.value || []), browser]
                              : (field.value || []).filter((b) => b !== browser);
                            field.onChange(newValue);
                          }}
                        />
                        <Label htmlFor={`browser-${browser}`} className="font-normal">{browser}</Label>
                      </div>
                    ))}
                  </div>
                )}
              />
              {form.formState.errors.browsers && <p className="text-sm text-destructive mt-1">{form.formState.errors.browsers.message}</p>}
            </div>
          )}

          {/* Step 3: Schedule Definition */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="frequency">{t('scheduleWizard.steps.step3.frequencyLabel')}</Label>
                <Controller
                  name="frequency"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step3.selectFrequencyPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {فرکانس‌های_موجود.map(freq => <SelectItem key={freq} value={freq}>{t(`scheduleWizard.frequencies.${freq}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {watchedFrequency === 'once' && (
                <Controller
                    name="nextRunAtOnce"
                    control={form.control}
                    render={({ field }) => (
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button variant={"outline"} className={`w-full justify-start text-left font-normal ${!field.value && "text-muted-foreground"}`}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value ? format(field.value, "PPP HH:mm") : <span>{t('scheduleWizard.steps.step3.pickDateTime')}</span>}
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                         {/* Basic Time Picker - can be improved with a dedicated time picker component */}
                        <div className="p-2 border-t">
                            <Input type="time" defaultValue={field.value ? format(field.value, "HH:mm") : "09:00"}
                                onChange={(e) => {
                                    const timeVal = e.target.value;
                                    if (field.value && timeVal) {
                                        const [h,m] = timeVal.split(':').map(Number);
                                        const newDate = new Date(field.value);
                                        newDate.setHours(h,m);
                                        field.onChange(newDate);
                                    } else if (timeVal) { // If no date selected yet, create one with current date
                                        const [h,m] = timeVal.split(':').map(Number);
                                        const newDate = new Date();
                                        newDate.setHours(h,m,0,0);
                                        field.onChange(newDate);
                                    }
                                }}
                            />
                        </div>
                        </PopoverContent>
                    </Popover>
                    )}
                />
              )}
              {watchedFrequency === 'daily' && (
                <div><Label htmlFor="dailyTime">{t('scheduleWizard.steps.step3.timeLabel')}</Label><Input id="dailyTime" type="time" {...form.register('dailyTime')} /></div>
              )}
              {watchedFrequency === 'weekly' && (
                <>
                  <div>
                    <Label htmlFor="weeklyDay">{t('scheduleWizard.steps.step3.dayOfWeekLabel')}</Label>
                    <Controller name="weeklyDay" control={form.control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}><SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step3.selectDayPlaceholder')} /></SelectTrigger>
                        <SelectContent>{روزهای_هفته_موجود.map(d => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}</SelectContent>
                      </Select>)}
                    />
                  </div>
                  <div><Label htmlFor="weeklyTime">{t('scheduleWizard.steps.step3.timeLabel')}</Label><Input id="weeklyTime" type="time" {...form.register('weeklyTime')} /></div>
                </>
              )}
              {watchedFrequency === 'monthly' && (
                 <>
                    <div>
                        <Label htmlFor="monthlyDate">{t('scheduleWizard.steps.step3.dayOfMonthLabel')}</Label>
                        <Controller name="monthlyDate" control={form.control} render={({field}) => (
                             <Input id="monthlyDate" type="number" min="1" max="31" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                        )}/>
                    </div>
                    <div><Label htmlFor="monthlyTime">{t('scheduleWizard.steps.step3.timeLabel')}</Label><Input id="monthlyTime" type="time" {...form.register('monthlyTime')} /></div>
                 </>
              )}
              {watchedFrequency === 'custom_cron' && (
                <div><Label htmlFor="customCronExpression">{t('scheduleWizard.steps.step3.cronExpressionLabel')}</Label><Input id="customCronExpression" {...form.register('customCronExpression')} placeholder="* * * * *" /></div>
              )}
              {Object.values(form.formState.errors).map(err => err.path && err.path.join('.').includes(watchedFrequency) && <p key={err.message} className="text-sm text-destructive mt-1">{err.message}</p>)}
            </div>
          )}

          {/* Step 4: Notifications */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <Label>{t('scheduleWizard.steps.step4.notificationsLabel')}</Label>
              <div>
                <Label htmlFor="notificationEmails">{t('scheduleWizard.steps.step4.emailRecipientsLabel')}</Label>
                <Input id="notificationEmails" {...form.register('notificationConfigOverride.emails')} placeholder={t('scheduleWizard.steps.step4.emailsPlaceholder')} />
              </div>
              {/* Slack placeholder for now */}
              <div>
                <Label htmlFor="notificationSlack">{t('scheduleWizard.steps.step4.slackChannelsLabel')}</Label>
                <Input id="notificationSlack" {...form.register('notificationConfigOverride.slackChannels')} placeholder={t('scheduleWizard.steps.step4.slackPlaceholder')} />
              </div>
              <div className="flex items-center space-x-2">
                <Controller name="notificationConfigOverride.onSuccess" control={form.control} render={({field}) => <Checkbox id="notifyOnSuccess" checked={field.value} onCheckedChange={field.onChange} />} />
                <Label htmlFor="notifyOnSuccess" className="font-normal">{t('scheduleWizard.steps.step4.notifyOnSuccessLabel')}</Label>
              </div>
               <div className="flex items-center space-x-2">
                <Controller name="notificationConfigOverride.onFailure" control={form.control} render={({field}) => <Checkbox id="notifyOnFailure" checked={field.value} onCheckedChange={field.onChange} />} />
                <Label htmlFor="notifyOnFailure" className="font-normal">{t('scheduleWizard.steps.step4.notifyOnFailureLabel')}</Label>
              </div>
            </div>
          )}

          {/* Step 5: Parameters & Advanced */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="executionParameters">{t('scheduleWizard.steps.step5.executionParametersLabel')}</Label>
                <Textarea id="executionParameters" {...form.register('executionParameters')} placeholder={t('scheduleWizard.steps.step5.jsonPlaceholder')} rows={5}/>
                {form.formState.errors.executionParameters && <p className="text-sm text-destructive mt-1">{form.formState.errors.executionParameters.message}</p>}
              </div>
              <div>
                <Label htmlFor="retryOnFailure">{t('scheduleWizard.steps.step5.retryOnFailureLabel')}</Label>
                 <Controller name="retryOnFailure" control={form.control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step5.selectRetryPlaceholder')} /></SelectTrigger>
                        <SelectContent>
                        {حالات_تلاش_مجدد_موجود.map(r => <SelectItem key={r} value={r}>{t(`scheduleWizard.retryOptions.${r}`)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )} />
              </div>
              <div className="flex items-center space-x-2">
                 <Controller name="isActive" control={form.control} render={({field}) => <Checkbox id="isActive" checked={field.value} onCheckedChange={field.onChange} />} />
                <Label htmlFor="isActive" className="font-normal">{t('scheduleWizard.steps.step5.activeLabel')}</Label>
              </div>
            </div>
          )}

          {/* Step 6: Summary */}
          {currentStep === 6 && (
            <div className="space-y-2">
              <h3 className="text-lg font-medium">{t('scheduleWizard.steps.step6.summaryTitle')}</h3>
              {/* TODO: Display a formatted summary of form.getValues() */}
              <pre className="p-2 bg-muted rounded-md text-xs overflow-x-auto">
                {JSON.stringify(form.getValues(), null, 2)}
              </pre>
            </div>
          )}
        </form>

        <DialogFooter className="mt-auto pt-4 border-t">
          <DialogClose asChild>
            <Button type="button" variant="outline" onClick={handleClose}>{t('scheduleWizard.buttons.cancel')}</Button>
          </DialogClose>
          {currentStep > 1 && <Button type="button" variant="outline" onClick={handlePrevious}>{t('scheduleWizard.buttons.previous')}</Button>}
          {currentStep < totalSteps && <Button type="button" onClick={handleNext}>{t('scheduleWizard.buttons.next')}</Button>}
          {currentStep === totalSteps && (
            <Button type="submit" onClick={form.handleSubmit(onSubmit)} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {scheduleToEdit ? t('scheduleWizard.buttons.saveChanges') : t('scheduleWizard.buttons.createSchedule')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleWizard;
