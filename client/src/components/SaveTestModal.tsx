import React, { useState, useEffect } from 'react';
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

interface SaveTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (testName: string) => void;
  initialTestName?: string;
}

const SaveTestModal: React.FC<SaveTestModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialTestName,
}) => {
  const [internalTestName, setInternalTestName] = useState(initialTestName || '');

  useEffect(() => {
    if (isOpen) {
      setInternalTestName(initialTestName || '');
    }
  }, [isOpen, initialTestName]);

  const handleSave = () => {
    if (internalTestName.trim()) {
      onSave(internalTestName.trim());
    }
  };

  const isSaveDisabled = internalTestName.trim() === '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save Test</DialogTitle>
          <DialogDescription>
            Please enter a name for your test. This will help you identify it later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="testName" className="text-right">
              Test Name
            </Label>
            <Input
              id="testName"
              value={internalTestName}
              onChange={(e) => setInternalTestName(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Login Functionality Test"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SaveTestModal;
