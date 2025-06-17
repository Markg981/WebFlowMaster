import React, { useState, useEffect } from 'react';
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
  const [testName, setTestName] = useState(initialTestName);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialProjectId);

  useEffect(() => {
    if (isOpen) {
      setTestName(initialTestName);
      setSelectedProjectId(initialProjectId);
    }
  }, [isOpen, initialTestName, initialProjectId]);

  const { data: projectsData } = useQuery<Project[]>(
    ['projects'],
    async () => (await apiRequest('GET', '/api/projects')).json(),
    { enabled: isOpen } // Only fetch when the modal is open
  );

  const handleSubmit = () => {
    if (testName.trim()) {
      onSave(testName.trim(), selectedProjectId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Update API Test' : 'Save New API Test'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the details for this API test.' : 'Enter a name for your new API test. You can also assign it to a project.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="testName">Test Name</Label>
            <Input
              id="testName"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="e.g., Get User Details"
              disabled={isLoading}
            />
          </div>
          <div>
            <Label htmlFor="testProject">Project (Optional)</Label>
            <Select
              value={selectedProjectId?.toString() || ''}
              onValueChange={(value) => setSelectedProjectId(value ? parseInt(value) : null)}
              disabled={isLoading || !projectsData}
            >
              <SelectTrigger id="testProject">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No Project</SelectItem>
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
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!testName.trim() || isLoading}>
            {isLoading ? (isEditing ? 'Updating...' : 'Saving...') : (isEditing ? 'Update Test' : 'Save Test')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
