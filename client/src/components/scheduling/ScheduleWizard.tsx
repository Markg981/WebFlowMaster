import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { 
  scheduleFormSchema, 
  ScheduleFormValues, 
  ENVIRONMENT_OPTIONS, 
  BROWSER_OPTIONS, 
  FREQUENCY_OPTIONS, 
  WEEK_DAY_OPTIONS, 
  RETRY_ON_FAILURE_OPTIONS, 
  transformFormValuesToApiPayload, 
  transformApiDataToFormValues 
} from '@/lib/schemas/scheduleFormSchema';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTestPlansAPI, type TestPlanSummary } from '@/lib/api/test-plans';
import { createSchedule, updateSchedule, TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Calendar } from "@/components/ui/calendar"; // For 'once' date
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

interface ScheduleWizardProps {
  isOpen: boolean;
  onClose: () => void;
  testPlanId?: string; // Pre-select if provided
  scheduleToEdit?: TestPlanScheduleEnhanced | null; // Schedule data for editing
  onScheduleSaved: () => void; // Callback after successful save
}

const ScheduleWizard: React.FC<ScheduleWizardProps> = ({ isOpen, onClose, testPlanId: initialTestPlanId, scheduleToEdit, onScheduleSaved }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 6;

  const { data: testPlansData, isLoading: isLoadingTestPlans } = useQuery<TestPlanSummary[]>({
    queryKey: ['testPlansSummary'],
    queryFn: fetchTestPlansAPI,
    enabled: isOpen,
  });

  const defaultValues = useMemo((): ScheduleFormValues => {
    if (scheduleToEdit) {
      return transformApiDataToFormValues(scheduleToEdit) as ScheduleFormValues;
    }
    return {
      testPlanId: initialTestPlanId || '',
      scheduleName: '',
      environment: ENVIRONMENT_OPTIONS[0].value,
      browsers: [BROWSER_OPTIONS[0].value as any],
      frequency: FREQUENCY_OPTIONS[0].value,
      nextRunAt: new Date(),
      isActive: true,
      retryOnFailure: RETRY_ON_FAILURE_OPTIONS[0].value,
    };
  }, [scheduleToEdit, initialTestPlanId]);

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues,
    mode: 'onChange',
  });

  useEffect(() => {
    if (scheduleToEdit) {
      form.reset(transformApiDataToFormValues(scheduleToEdit) as ScheduleFormValues);
    } else {
      form.reset({
        ...defaultValues,
        testPlanId: initialTestPlanId || (testPlansData && testPlansData.length > 0 ? testPlansData[0].id : ''),
      });
    }
  }, [scheduleToEdit, initialTestPlanId, form, defaultValues, testPlansData]);

  const createMutation = useMutation({
    mutationFn: (data: any) => createSchedule(data),
    onSuccess: () => {
      toast({ title: t('scheduleWizard.toast.success.createTitle'), description: t('scheduleWizard.toast.success.createDescription') });
      queryClient.invalidateQueries({ queryKey: ['testPlanSchedules'] });
      onScheduleSaved();
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: t('scheduleWizard.toast.error.createTitle'), description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string, data: any }) => updateSchedule(vars.id, vars.data),
    onSuccess: () => {
      toast({ title: t('scheduleWizard.toast.success.updateTitle'), description: t('scheduleWizard.toast.success.updateDescription') });
      queryClient.invalidateQueries({ queryKey: ['testPlanSchedules'] });
      onScheduleSaved();
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: t('scheduleWizard.toast.error.updateTitle'), description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: ScheduleFormValues) => {
    const payload = transformFormValuesToApiPayload(data);
    if (scheduleToEdit?.id) {
      updateMutation.mutate({ id: scheduleToEdit.id, data: payload as any });
    } else {
      createMutation.mutate(payload as any);
    }
  };

  const handleNext = async () => {
    const result = await form.trigger();
    if (result) {
      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
    } else {
      toast({title: t('scheduleWizard.toast.error.validationError'), description: t('scheduleWizard.toast.error.checkFields'), variant: "destructive"})
    }
  };

  const handlePrevious = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  const handleClose = () => {
    form.reset();
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
                        {testPlansData?.map(plan => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label htmlFor="scheduleName">{t('scheduleWizard.steps.step1.scheduleNameLabel')}</Label>
                <Input id="scheduleName" {...form.register('scheduleName')} />
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
                        {ENVIRONMENT_OPTIONS.map(env => <SelectItem key={env.value} value={env.value}>{env.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <Label>{t('scheduleWizard.steps.step2.browsersLabel')}</Label>
              <Controller
                name="browsers"
                control={form.control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BROWSER_OPTIONS.map((browser) => (
                      <div key={browser.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`browser-${browser.value}`}
                          checked={field.value?.includes(browser.value as any)}
                          onCheckedChange={(checked) => {
                            const newValue = checked
                              ? [...(field.value || []), browser.value]
                              : (field.value || []).filter((b: any) => b !== browser.value);
                            field.onChange(newValue);
                          }}
                        />
                        <Label htmlFor={`browser-${browser.value}`} className="font-normal">{browser.label}</Label>
                      </div>
                    ))}
                  </div>
                )}
              />
            </div>
          )}

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
                        {FREQUENCY_OPTIONS.map(freq => <SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {watchedFrequency === 'once' && (
                <Controller
                    name="nextRunAt"
                    control={form.control}
                    render={({ field }) => (
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button variant={"outline"} className={`w-full justify-start text-left font-normal ${!field.value && "text-muted-foreground"}`}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value instanceof Date ? format(field.value, "PPP HH:mm") : <span>{t('scheduleWizard.steps.step3.pickDateTime')}</span>}
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                        <Calendar mode="single" selected={field.value instanceof Date ? field.value : undefined} onSelect={field.onChange} initialFocus />
                        </PopoverContent>
                    </Popover>
                    )}
                />
              )}
              {watchedFrequency === 'custom_cron' && (
                <div><Label htmlFor="customCronExpression">{t('scheduleWizard.steps.step3.cronExpressionLabel')}</Label><Input id="customCronExpression" {...form.register('customCronExpression')} placeholder="* * * * *" /></div>
              )}
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <Label>{t('scheduleWizard.steps.step4.notificationsLabel')}</Label>
              <div>
                <Label htmlFor="notificationConfigOverride">{t('scheduleWizard.steps.step4.emailRecipientsLabel')}</Label>
                <Textarea id="notificationConfigOverride" {...form.register('notificationConfigOverride')} placeholder='{"emails": "..."}' />
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="executionParameters">{t('scheduleWizard.steps.step5.executionParametersLabel')}</Label>
                <Textarea id="executionParameters" {...form.register('executionParameters')} placeholder='{"var": "val"}' rows={5}/>
              </div>
              <div>
                <Label htmlFor="retryOnFailure">{t('scheduleWizard.steps.step5.retryOnFailureLabel')}</Label>
                 <Controller name="retryOnFailure" control={form.control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder={t('scheduleWizard.steps.step5.selectRetryPlaceholder')} /></SelectTrigger>
                        <SelectContent>
                        {RETRY_ON_FAILURE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
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

          {currentStep === 6 && (
            <div className="space-y-2">
              <h3 className="text-lg font-medium">{t('scheduleWizard.steps.step6.summaryTitle')}</h3>
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
