import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose, // Import DialogClose for the nested modal
} from '@/components/ui/dialog'; // Assuming this is the correct path for ShadCN Dialog
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react'; // For loading state in dropdown

import { useMutation, useQueryClient } from '@tanstack/react-query'; // Added imports
import { apiRequest } from '@/lib/queryClient'; // Added import
import { toast } from '@/hooks/use-toast'; // Added import

// Define Project type locally
interface Project {
  id: number;
  name: string;
  // Add other fields if necessary, but for selection, id and name are key
}

// API function for fetching projects
const fetchProjects = async (): Promise<Project[]> => {
  // Using apiRequest for consistency, though direct fetch is also fine here.
  // Assuming apiRequest is set up to handle JSON parsing and errors.
  const response = await apiRequest("GET", "/api/projects");
  // apiRequest is expected to throw on error, so direct return if successful.
  // It should also parse JSON, so response should be Project[] directly if apiRequest handles it.
  // If apiRequest returns the raw Response object, then:
  // if (!response.ok) {
  //   const errorData = await response.json().catch(() => ({ error: "Failed to fetch projects and parse error" }));
  //   throw new Error(errorData.error || "Failed to fetch projects");
  // }
  // return response.json();
  return response as Project[]; // Assuming apiRequest returns parsed JSON based on typical setup
};

interface SaveTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (testName: string, projectId?: number) => void; // Updated onSave signature
  initialTestName?: string;
}

const SaveTestModal: React.FC<SaveTestModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialTestName,
}) => {
  const { t } = useTranslation();
  const [internalTestName, setInternalTestName] = useState(initialTestName || '');
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const queryClient = useQueryClient(); // For invalidating queries

  // Fetch projects only when the modal is open
  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    isError: isErrorProjects,
    refetch: refetchProjects, // Get refetch function
    // error: projectsError // Can be used to display specific error messages
  } = useQuery<Project[], Error>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled: isOpen, // Only fetch when modal is open
  });

  const createProjectMutation = useMutation<Project, Error, { name: string }>({
    mutationFn: async (projectData) => {
      const response = await apiRequest("POST", "/api/projects", projectData);
      // Assuming apiRequest returns parsed JSON on success
      return response as Project;
    },
    onSuccess: (newlyCreatedProject) => {
      toast({ title: t('saveTestModal.notifications.projectCreated.title', 'Project Created'), description: t('saveTestModal.notifications.projectCreated.description', `Project "${newlyCreatedProject.name}" created successfully.`) });
      setIsCreateProjectModalOpen(false);
      setNewProjectName('');
      // Invalidate and refetch projects query
      queryClient.invalidateQueries({ queryKey: ['projects'] }).then(() => {
        // After projects are refetched, select the new one.
        // This requires projectsData to be updated from the query.
        // A useEffect watching projectsData might be cleaner for this auto-selection.
        // For now, let's try setting it directly if the new project is in the fresh list.
        // This part can be tricky due to timing.
        setSelectedProjectId(newlyCreatedProject.id.toString());
      });
    },
    onError: (error) => {
      toast({ title: t('saveTestModal.notifications.projectCreateFailed.title', 'Project Creation Failed'), description: error.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (isOpen) {
      setInternalTestName(initialTestName || '');
      setSelectedProjectId(undefined); // Reset project selection
    }
  }, [isOpen, initialTestName]);

  const handleSave = () => {
    if (internalTestName.trim()) {
      const projectId = selectedProjectId ? parseInt(selectedProjectId, 10) : undefined;
      onSave(internalTestName.trim(), projectId);
    }
  };

  const isSaveDisabled = internalTestName.trim() === '' || !selectedProjectId;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('saveTestModal.saveTest.button')}</DialogTitle>
          <DialogDescription>
            {t('saveTestModal.pleaseEnterANameForYour.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="testName" className="text-right">
              {t('saveTestModal.testName.label')}
            </Label>
            <Input
              id="testName"
              value={internalTestName}
              onChange={(e) => setInternalTestName(e.target.value)}
              className="col-span-3"
              placeholder={t('saveTestModal.egLoginFunctionalityTest.placeholder')}
            />
          </div>
          {/* Project Selection Dropdown */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="projectSelect" className="text-right">
              {t('saveTestModal.project.label')}<span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              disabled={isLoadingProjects}
            >
              <SelectTrigger className="col-span-3" id="projectSelect">
                <SelectValue placeholder={t('saveTestModal.selectAProjectOptional.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {isLoadingProjects ? (
                  <div className="flex items-center justify-center p-2">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('saveTestModal.loadingProjects.text')}
                  </div>
                ) : isErrorProjects ? (
                  <div className="p-2 text-red-500 text-sm">{t('saveTestModal.errorLoadingProjects.text')}</div>
                ) : projectsData && projectsData.length > 0 ? (
                  projectsData.map((project) => (
                    <SelectItem key={project.id} value={project.id.toString()}>
                      {project.name}
                    </SelectItem>
                  ))
                ) : (
                  <div className="p-2 text-muted-foreground text-sm">{t('saveTestModal.noProjectsAvailable.text')}</div>
                )}
              </SelectContent>
            </Select>
          </div>
          {/* Button to open Create New Project modal */}
          <div className="grid grid-cols-4 items-center gap-4">
            <div className="col-start-2 col-span-3"> {/* Align with input fields */}
              <Button
                type="button" // Prevent form submission if it were inside a form
                variant="outline"
                size="sm"
                onClick={() => setIsCreateProjectModalOpen(true)}
                className="w-full"
              >
                {t('saveTestModal.createNewProject.button', 'Create New Project')}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('saveTestModal.cancel.button')}
          </Button>
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            {t('saveTestModal.save.button')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Nested Dialog for Creating a New Project */}
      <Dialog open={isCreateProjectModalOpen} onOpenChange={setIsCreateProjectModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('saveTestModal.createProjectModal.title', 'Create New Project')}</DialogTitle>
            <DialogDescription>
              {t('saveTestModal.createProjectModal.description', 'Enter a name for your new project.')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="newProjectNameInput">{t('saveTestModal.createProjectModal.projectName.label', 'Project Name')}</Label>
            <Input
              id="newProjectNameInput"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('saveTestModal.createProjectModal.projectName.placeholder', 'e.g., My Awesome Project')}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={() => { setIsCreateProjectModalOpen(false); setNewProjectName(''); }}>
                {t('saveTestModal.cancel.button', 'Cancel')}
              </Button>
            </DialogClose>
            <Button
              onClick={() => createProjectMutation.mutate({ name: newProjectName.trim() })}
              disabled={newProjectName.trim() === '' || createProjectMutation.isPending}
            >
              {createProjectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('saveTestModal.createProjectModal.saveProject.button', 'Save Project')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

export default SaveTestModal;
