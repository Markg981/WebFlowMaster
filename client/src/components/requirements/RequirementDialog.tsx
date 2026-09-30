import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { REQUIREMENT_KEY_PATTERN, REQUIREMENT_KINDS, type RequirementKind } from '@shared/requirements';

/** Typing a requirement in, or changing one: its key, title, kind and the epic it belongs to. */

export interface RequirementPayload {
  key: string;
  title: string;
  description: string | null;
  kind: RequirementKind;
  parentId: number | null;
}

export interface RequirementOption {
  id: number;
  key: string;
  title: string;
  kind: RequirementKind;
}

const NO_PARENT = 'none';

interface Props {
  isOpen: boolean;
  /** The requirement being changed; null to create one. */
  requirement: (RequirementPayload & { id: number }) | null;
  /** What it can be put under: every other requirement. */
  options: RequirementOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: RequirementPayload) => void;
}

export default function RequirementDialog({ isOpen, requirement, options, saving, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<RequirementKind>('story');
  const [parentId, setParentId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setKey(requirement?.key ?? '');
    setTitle(requirement?.title ?? '');
    setDescription(requirement?.description ?? '');
    setKind(requirement?.kind ?? 'story');
    setParentId(requirement?.parentId ?? null);
  }, [isOpen, requirement]);

  const keyValid = REQUIREMENT_KEY_PATTERN.test(key.trim());
  const valid = keyValid && title.trim().length > 0;
  const parents = options.filter((option) => option.id !== requirement?.id);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {requirement ? t('requirements.dialog.editTitle', 'Edit requirement') : t('requirements.dialog.createTitle', 'New requirement')}
          </DialogTitle>
          <DialogDescription>
            {t('requirements.dialog.description', 'An epic, a user story or a requirement. Link tests to it to see whether it is covered and passing.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="requirement-key">{t('requirements.fields.key', 'Key')}</Label>
              <Input id="requirement-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="SHOP-142" maxLength={64} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="requirement-kind">{t('requirements.fields.kind', 'Kind')}</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as RequirementKind)}>
                <SelectTrigger id="requirement-kind" aria-label={t('requirements.fields.kind', 'Kind')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENT_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`requirements.kind.${option}`, option === 'epic' ? 'Epic' : option === 'story' ? 'User story' : 'Requirement')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {key.trim() !== '' && !keyValid && (
            <p className="text-xs text-destructive">
              {t('requirements.keyHint', 'Letters, digits, dots, dashes and underscores, like SHOP-142 or REQ_12.')}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="requirement-title">{t('requirements.fields.title', 'Title')}</Label>
            <Input id="requirement-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="requirement-parent">{t('requirements.fields.parent', 'Belongs to')}</Label>
            <Select value={parentId == null ? NO_PARENT : String(parentId)} onValueChange={(value) => setParentId(value === NO_PARENT ? null : Number(value))}>
              <SelectTrigger id="requirement-parent" aria-label={t('requirements.fields.parent', 'Belongs to')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t('requirements.noParent', 'Nothing: top level')}</SelectItem>
                {parents.map((option) => (
                  <SelectItem key={option.id} value={String(option.id)}>
                    {option.key} — {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="requirement-description">{t('requirements.fields.description', 'Description')}</Label>
            <Textarea id="requirement-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('requirements.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() => onSave({ key: key.trim(), title: title.trim(), description: description.trim() || null, kind, parentId })}
            disabled={!valid || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('requirements.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
