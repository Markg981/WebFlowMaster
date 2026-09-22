import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

/**
 * Keeping a detected element in a project's repository.
 *
 * The project has to be named here because a selector is a fact about one application, and the
 * builder does not otherwise know which one it is looking at until the test is saved.
 */

export interface KeepableElement {
  selector: string;
  frameSelector?: string | null;
  text?: string | null;
  tag?: string;
  type?: string;
  attributes?: Record<string, string>;
}

interface Project {
  id: number;
  name: string;
}

interface KeepElementModalProps {
  isOpen: boolean;
  onClose: () => void;
  element: KeepableElement | null;
  onKept: (input: { projectId: number; name: string }) => Promise<void>;
}

/** A first guess at the name, from whatever the page called the thing. */
export function suggestedName(element: KeepableElement | null): string {
  if (!element) return '';
  const label = (element.text ?? '').trim() || element.attributes?.placeholder || element.attributes?.alt || '';
  const kind = element.type || element.tag || 'element';
  return (label ? `${label} ${kind}` : kind).slice(0, 80);
}

const KeepElementModal: React.FC<KeepElementModalProps> = ({ isOpen, onClose, element, onKept }) => {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState<string>('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: projects = [] } = useQuery<Project[], Error>({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Could not load projects');
      return response.json();
    },
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setName(suggestedName(element));
    setError('');
  }, [isOpen, element]);

  const handleSave = async () => {
    if (!projectId) {
      setError(t('keepElement.projectRequired', 'Choose the project this element belongs to.'));
      return;
    }
    if (name.trim() === '') {
      setError(t('keepElement.nameRequired', 'Give the element a name — it is how it will be recognised.'));
      return;
    }
    setError('');
    setIsSaving(true);
    try {
      await onKept({ projectId: Number(projectId), name: name.trim() });
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message ?? 'Could not keep the element');
    } finally {
      setIsSaving(false);
    }
  };

  const safeProjects = Array.isArray(projects) ? projects : [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('keepElement.title', 'Keep this element')}</DialogTitle>
          <DialogDescription>
            {t(
              'keepElement.description',
              'The project owns this element from now on: every test that uses it reads one selector, and a repair reaches all of them at once.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="keepElementProject">{t('keepElement.projectLabel', 'Project')}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="keepElementProject" className="mt-1">
                <SelectValue placeholder={t('keepElement.projectPlaceholder', 'Choose a project')} />
              </SelectTrigger>
              <SelectContent>
                {safeProjects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="keepElementName">{t('keepElement.nameLabel', 'Name')}</Label>
            <Input id="keepElementName" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          {element && (
            <p className="text-xs text-muted-foreground break-all">
              {t('keepElement.selector', 'Selector')}: <code>{element.selector}</code>
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('keepElement.save', 'Keep')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default KeepElementModal;
