import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAllSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  type TestPlanScheduleEnhanced,
  type CreateScheduleClientPayload,
  type UpdateScheduleClientPayload,
} from '@/lib/api/schedules';
import SchedulesList from '@/components/scheduling/SchedulesList';
import ScheduleForm from '@/components/scheduling/ScheduleForm';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react'; // Changed from @radix-ui/react-icons
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'; // DialogClose might be needed
import { useToast } from '@/components/ui/use-toast';  // Corrected import path
import { useTranslation } from 'react-i18next';
// Added imports for header

const SchedulingPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation(); // Added translation hook

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TestPlanScheduleEnhanced | null>(null);
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const [scheduleToDeleteId, setScheduleToDeleteId] = useState<string | null>(null);


  const { data: schedules, isLoading, error } = useQuery<TestPlanScheduleEnhanced[], Error>({
    queryKey: ['schedules'],
    queryFn: fetchAllSchedules,
  });

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setIsFormOpen(false);
      setEditingSchedule(null);
    },
    onError: (err: Error) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'An unexpected error occurred.',
      });
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateScheduleClientPayload) => createSchedule(data),
    ...mutationOptions,
    onSuccess: () => {
      mutationOptions.onSuccess?.();
      toast({ title: 'Success', description: 'Schedule created successfully.' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateScheduleClientPayload }) => updateSchedule(id, data),
    ...mutationOptions,
    onSuccess: () => {
      mutationOptions.onSuccess?.();
      toast({ title: 'Success', description: 'Schedule updated successfully.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast({ title: 'Success', description: 'Schedule deleted successfully.' });
      setIsConfirmDeleteDialogOpen(false);
      setScheduleToDeleteId(null);
    },
    onError: (err: Error) => {
      toast({
        variant: 'destructive',
        title: 'Error deleting schedule',
        description: err.message,
      });
      setIsConfirmDeleteDialogOpen(false);
      setScheduleToDeleteId(null);
    },
  });

  const handleOpenCreateForm = () => {
    setEditingSchedule(null);
    setIsFormOpen(true);
  };

  const handleEditSchedule = (schedule: TestPlanScheduleEnhanced) => {
    setEditingSchedule(schedule);
    setIsFormOpen(true);
  };

  const handleDeleteScheduleAttempt = (scheduleId: string) => {
    setScheduleToDeleteId(scheduleId);
    setIsConfirmDeleteDialogOpen(true);
  };

  const confirmDeleteSchedule = () => {
    if (scheduleToDeleteId) {
      deleteMutation.mutate(scheduleToDeleteId);
    }
  };


  const handleFormSubmit = async (data: CreateScheduleClientPayload | UpdateScheduleClientPayload) => {
    if (editingSchedule && editingSchedule.id) {
      // Type assertion for UpdateScheduleClientPayload
      await updateMutation.mutateAsync({ id: editingSchedule.id, data: data as UpdateScheduleClientPayload });
    } else {
      // Type assertion for CreateScheduleClientPayload
      await createMutation.mutateAsync(data as CreateScheduleClientPayload);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('schedulingPage.eyebrow', 'Automation')}
            </div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{t('schedulingPage.title', 'Scheduling')}</h1>
          </div>
          <Button variant="default" size="sm" onClick={handleOpenCreateForm}>
            <PlusCircle className="mr-2 h-4 w-4" /> {t('schedulingPage.createSchedule.button', 'Create Schedule')}
          </Button>
        </div>
      </header>

      {/* Main content area */}
      <div>
        {/* Dialogs remain outside the scrollable content typically, or are portalled */}
        <Dialog open={isFormOpen} onOpenChange={(open) => {
          if (!open) {
            setEditingSchedule(null); // Clear editing state when dialog closes
          }
          setIsFormOpen(open);
        }}>
          <DialogContent className="sm:max-w-[600px] md:max-w-[750px] lg:max-w-[900px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingSchedule ? t('schedulingPage.editSchedule.title', 'Edit Schedule') : t('schedulingPage.createNewSchedule.title', 'Create New Schedule')}</DialogTitle>
              {editingSchedule && <DialogDescription>{t('schedulingPage.editingSchedule.description', 'Editing schedule:')} {editingSchedule.scheduleName}</DialogDescription>}
            </DialogHeader>
            <ScheduleForm
              initialData={editingSchedule || undefined}
              onSubmit={handleFormSubmit}
              onCancel={() => {
                setIsFormOpen(false);
                setEditingSchedule(null);
              }}
              isSubmitting={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={isConfirmDeleteDialogOpen} onOpenChange={setIsConfirmDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('schedulingPage.confirmDeletion.title', 'Confirm Deletion')}</DialogTitle>
              <DialogDescription>
                {t('schedulingPage.confirmDeletion.description', 'Are you sure you want to delete this schedule? This action cannot be undone.')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsConfirmDeleteDialogOpen(false)} disabled={deleteMutation.isPending}>
                {t('schedulingPage.cancel.button', 'Cancel')}
              </Button>
              <Button variant="destructive" onClick={confirmDeleteSchedule} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? t('schedulingPage.deleting.button', 'Deleting...') : t('schedulingPage.delete.button', 'Delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SchedulesList
          schedules={schedules || []}
          onEdit={handleEditSchedule}
          onDelete={handleDeleteScheduleAttempt}
          isLoading={isLoading}
          error={error}
        />
      </div>
    </div>
  );
};

export default SchedulingPage;
