import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'; // Assuming this is the correct path for ShadCN Dialog
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react'; // For loading state in dropdown

// Define Project type locally
interface Project {
  id: number;
  name: string;
  // Add other fields if necessary, but for selection, id and name are key
}

// API function for fetching projects
const fetchProjects = async (): Promise<Project[]> => {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to fetch projects");
  }
  return response.json();
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

  // Fetch projects only when the modal is open
  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    isError: isErrorProjects,
    // error: projectsError // Can be used to display specific error messages
  } = useQuery<Project[], Error>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled: isOpen, // Only fetch when modal is open
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

  const isSaveDisabled = internalTestName.trim() === '';

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
              {t('saveTestModal.project.label')}
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
    </Dialog>
  );
};

export default SaveTestModal;
