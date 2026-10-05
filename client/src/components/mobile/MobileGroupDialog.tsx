import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mobileGroupSchema, type MobileGroupDefinition } from '@shared/mobile-groups';
import type { MobileStep, MobilePlatform } from '@shared/mobile';
import MobileStepsEditor from './MobileStepsEditor';

export default function MobileGroupDialog({
  group,
  open,
  onClose,
  onSaved,
}: {
  group: MobileGroupDefinition | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState<MobilePlatform>('android');
  const [steps, setSteps] = useState<MobileStep[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Array<{ id: number; name: string; access?: string }>>(
    [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setPlatform(group?.platform ?? 'android');
    setSteps(group?.steps ?? []);
    setProjectId(group?.projectId ?? null);
    setError('');
    let active = true;
    fetch('/api/projects')
      .then(async (r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (active) setProjects(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setProjects([]);
      });
    return () => {
      active = false;
    };
  }, [open, group]);
  const save = async () => {
    const candidate = mobileGroupSchema.safeParse({
      name,
      description,
      platform,
      steps,
      projectId,
    });
    if (!candidate.success) {
      setError(candidate.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/mobile-step-groups${group ? `/${group.id}` : ''}`, {
        method: group ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate.data),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('mobileTests.flow.groupEditor', 'Mobile step group')}</DialogTitle>
        </DialogHeader>
        <Label htmlFor="mobile-group-name">{t('mobileTests.name', 'Name')}</Label>
        <Input id="mobile-group-name" value={name} onChange={(e) => setName(e.target.value)} />
        <Label htmlFor="mobile-group-description">
          {t('mobileTests.flow.description', 'Description')}
        </Label>
        <Input
          id="mobile-group-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Label htmlFor="mobile-group-platform">{t('mobileTests.platform', 'Platform')}</Label>
        <select
          id="mobile-group-platform"
          className="rounded border bg-background p-2"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as MobilePlatform)}
        >
          <option value="android">Android</option>
          <option value="ios">iOS</option>
        </select>
        <Label htmlFor="mobile-group-project">{t('mobileTests.project', 'Project')}</Label>
        <select
          id="mobile-group-project"
          className="rounded border bg-background p-2"
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t('mobileTests.noProject', 'No project')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id} disabled={project.access === 'viewer'}>
              {project.name}
            </option>
          ))}
        </select>
        <MobileStepsEditor
          steps={steps}
          platform={platform}
          groups={[]}
          allowGroups={false}
          onChange={setSteps}
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('mobileTests.close', 'Close')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {t('mobileTests.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
