import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

/**
 * Turning what is in the builder into a group other tests can call.
 *
 * This is where a step group comes from: there is no separate editor for one, because a group
 * is an ordinary sequence and the builder is where sequences are built. Editing a group later
 * means opening it here again and saving over it.
 */

interface SaveStepGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  stepCount: number;
  /** Rejected with a message the dialog shows, so the caller owns the request. */
  onSave: (input: { name: string; description?: string }) => Promise<void>;
}

const SaveStepGroupModal: React.FC<SaveStepGroupModalProps> = ({ isOpen, onClose, stepCount, onSave }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDescription('');
    setError('');
  }, [isOpen]);

  const handleSave = async () => {
    if (name.trim() === '') {
      setError(t('saveStepGroup.nameRequired', 'Give the group a name — it is how tests will call it.'));
      return;
    }
    setError('');
    setIsSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined });
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Could not save the step group');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('saveStepGroup.title', 'Save as step group')}</DialogTitle>
          <DialogDescription>
            {t(
              'saveStepGroup.description',
              'These {{count}} steps become a group. A test that calls it runs whatever the group holds at the time it runs, so editing the group later changes every test that calls it.',
              { count: stepCount },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="stepGroupName">{t('saveStepGroup.nameLabel', 'Name')}</Label>
            <Input
              id="stepGroupName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('saveStepGroup.namePlaceholder', 'Login')}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="stepGroupDescription">{t('saveStepGroup.descriptionLabel', 'Description')}</Label>
            <Textarea
              id="stepGroupDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SaveStepGroupModal;
