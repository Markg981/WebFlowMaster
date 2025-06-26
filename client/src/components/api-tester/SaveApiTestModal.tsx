import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/lib/queryClient'; // For fetching projects
import { Project } from '@shared/schema'; // Type for projects
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';

const NO_PROJECT_SENTINEL = "_no_project_";

interface SaveApiTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, projectId?: number | null) => void;
  initialTestName?: string;
  initialProjectId?: number | null;
  isEditing: boolean;
  isLoading?: boolean;
}

export const SaveApiTestModal: React.FC<SaveApiTestModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialTestName = '',
  initialProjectId = null,
  isEditing,
  isLoading,
}) => {
  const { t } = useTranslation();
  const [testName, setTestName] = useState(initialTestName);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialProjectId);

  useEffect(() => {
    if (isOpen) {
      setTestName(initialTestName);
      setSelectedProjectId(initialProjectId);
    }
  }, [isOpen, initialTestName, initialProjectId]);

  const { data: projectsData, isLoading: isLoadingProjects } = useQuery<Project[], Error>({
    queryKey: ['projects'],
    queryFn: async () => (await apiRequest('GET', '/api/projects')).json(),
    enabled: isOpen, // Only fetch when the modal is open
    staleTime: 5 * 60 * 1000, // Example: 5 minutes stale time
  });

  const handleSubmit = () => {
    if (testName.trim()) {
      onSave(testName.trim(), selectedProjectId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? t('apiTester.saveApiTestModal.updateApiTest.title') : t('apiTester.saveApiTestModal.saveNewApiTest.title')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('apiTester.saveApiTestModal.updateTheDetailsForThisApi.description') : t('apiTester.saveApiTestModal.enterANameForYourNewApi.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="testName">{t('apiTester.saveApiTestModal.testName.label')}</Label>
            <Input
              id="testName"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder={t('apiTester.saveApiTestModal.egGetUserDetails.placeholder')}
              disabled={isLoading}
            />
          </div>
          <div>
            <Label htmlFor="testProject">{t('apiTester.saveApiTestModal.projectOptional.label')}</Label>
            <Select
              value={selectedProjectId !== null ? selectedProjectId.toString() : NO_PROJECT_SENTINEL}
              onValueChange={(value) => {
                if (value === NO_PROJECT_SENTINEL) {
                  setSelectedProjectId(null);
                } else {
                  setSelectedProjectId(parseInt(value)); // Assuming project IDs are numbers
                }
              }}
              disabled={isLoading || isLoadingProjects || !projectsData}
            >
              <SelectTrigger id="testProject">
                <SelectValue placeholder={t('apiTester.saveApiTestModal.selectAProject.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT_SENTINEL}>{t('apiTester.saveApiTestModal.noProject.text')}</SelectItem>
                {projectsData?.map((project) => (
                  <SelectItem key={project.id} value={project.id.toString()}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {t('saveTestModal.cancel.button')}
          </Button>
          <Button onClick={handleSubmit} disabled={!testName.trim() || isLoading}>
            {isLoading ? (isEditing ? t('apiTester.saveApiTestModal.updating.button') : t('testsPage.saving.button')) : (isEditing ? t('apiTester.saveApiTestModal.updateTest.button') : t('apiTesterPage.saveTest.button'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
