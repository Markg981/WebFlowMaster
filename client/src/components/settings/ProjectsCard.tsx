import { useState } from 'react';
import { errorMessage } from '@/lib/queryClient';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTree, Loader2, Lock, PlusCircle, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ProjectAccessDialog from '@/components/settings/ProjectAccessDialog';
import { useProjects, type ProjectSummary } from '@/hooks/use-projects';

type Project = ProjectSummary;

const createProject = async (projectName: string): Promise<Project> => {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create project');
  }
  return response.json();
};

const deleteProject = async (projectId: number): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 204) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to delete project');
  }
  if (response.status === 204) return;
  if (response.ok) return response.json();
};

/** Settings → Projects: create, list, delete and, for owners, who may see a restricted one. */
export default function ProjectsCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [newProjectName, setNewProjectName] = useState('');
  /** The project whose access dialog is open, for owners. */
  const [accessProjectId, setAccessProjectId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);

  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    isError: isErrorProjects,
    error: projectsError,
  } = useProjects();

  const createProjectMutation = useMutation<Project, Error, string>({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: t('settingsPage.toasts.projectCreated.title', 'Project Created'),
        description: t(
          'settingsPage.toasts.projectCreated.description',
          'The new project has been created successfully.',
        ),
      });
      setNewProjectName('');
    },
    onError: (error) => {
      toast({
        title: t('settingsPage.toasts.projectCreateFailed.title', 'Error Creating Project'),
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const deleteProjectMutation = useMutation<void, Error, number>({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: t('settingsPage.toasts.projectDeleted.title', 'Project Deleted'),
        description: t(
          'settingsPage.toasts.projectDeleted.description',
          'The project has been deleted successfully.',
        ),
      });
    },
    onError: (error) => {
      toast({
        title: t('settingsPage.toasts.projectDeleteFailed.title', 'Error Deleting Project'),
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const handleCreateProject = () => {
    if (newProjectName.trim() === '') {
      toast({
        title: t('settingsPage.toasts.projectNameEmpty.title', 'Project name cannot be empty'),
        variant: 'destructive',
      });
      return;
    }
    createProjectMutation.mutate(newProjectName.trim());
  };

  const confirmDeleteProject = () => {
    if (deleting) deleteProjectMutation.mutate(deleting.id);
    setDeleting(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <ListTree className="h-4 w-4 text-muted-foreground" />
            <span>{t('settingsPage.projectManagement.title')}</span>
          </CardTitle>
          <CardDescription>
            {t('settingsPage.createAndManageYourProjects.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="new-project-name">{t('settingsPage.newProjectName.label')}</Label>
            <div className="flex space-x-2">
              <Input
                id="new-project-name"
                placeholder={t('settingsPage.enterProjectName.placeholder')}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={createProjectMutation.isPending}
              />
              <Button
                onClick={handleCreateProject}
                disabled={createProjectMutation.isPending || newProjectName.trim() === ''}
              >
                {createProjectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4 mr-2" />
                )}{' '}
                {t('settingsPage.createProject.button')}
              </Button>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-md font-medium">{t('settingsPage.existingProjects.title')}</h3>
            {isLoadingProjects ? (
              <div className="flex items-center space-x-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('settingsPage.loadingProjects.text')}</span>
              </div>
            ) : isErrorProjects ? (
              <p className="text-destructive">Error: {projectsError?.message}</p>
            ) : projectsData && projectsData.length > 0 ? (
              <ul className="space-y-2">
                {projectsData.map((project) => {
                  const isDeletingThis =
                    deleteProjectMutation.isPending &&
                    deleteProjectMutation.variables === project.id;
                  return (
                    <li
                      key={project.id}
                      className="flex items-center justify-between p-2 border rounded-md"
                      data-testid={`project-${project.id}`}
                    >
                      <span className="text-sm flex items-center gap-2">
                        {project.name}
                        {project.restricted && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Lock className="h-3 w-3" />
                            {t('projectAccess.restrictedBadge', 'restricted')}
                          </Badge>
                        )}
                        {project.access === 'viewer' && user?.role !== 'viewer' && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t('projectAccess.readOnly', 'read-only for you')}
                          </Badge>
                        )}
                      </span>
                      <span className="flex items-center">
                        {user?.role === 'owner' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('projectAccess.open', 'Access to {{name}}', {
                              name: project.name,
                            })}
                            onClick={() => setAccessProjectId(project.id)}
                          >
                            <Users className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Icon-only control: without an aria-label it has no accessible name. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t(
                            'settingsPage.deleteProject.ariaLabel',
                            'Delete project {{name}}',
                            { name: project.name },
                          )}
                          onClick={() => setDeleting({ id: project.id, name: project.name })}
                          disabled={isDeletingThis}
                        >
                          {isDeletingThis ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('settingsPage.noProjectsFound.text')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {accessProjectId !== null && (
        <ProjectAccessDialog
          projectId={accessProjectId}
          open
          onOpenChange={(open) => {
            if (!open) setAccessProjectId(null);
          }}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settingsPage.deleteProjectDialog.title', 'Confirm Project Deletion')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'settingsPage.deleteProjectDialog.description',
                'Are you sure you want to delete project "{{name}}"? This action cannot be undone.',
                { name: deleting?.name ?? '' },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleting(null)}>
              {t('settingsPage.deleteProjectDialog.cancelButton', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {t('settingsPage.deleteProjectDialog.deleteButton', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
