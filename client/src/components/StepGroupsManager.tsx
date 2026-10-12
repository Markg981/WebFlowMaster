import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Layers, ListTree, Loader2, Pencil, Save, Trash2, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

/**
 * Looking after the step groups a test can call: what each is used by, a rename, new steps,
 * and deletion.
 *
 * A group is an ordinary sequence with a name, and the builder is the only place sequences are
 * built — so this dialog edits a group's name and description itself, and for its steps goes
 * through the builder: open the group there, change the steps, then save them over it from
 * here. What every edit needs first is the list of tests that call the group, because changing
 * a group changes all of them on their next run; the usage view answers that.
 */

export interface WebStepGroup {
  id: string;
  name: string;
  description: string | null;
  sequence: unknown[];
}

interface StepGroupsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: WebStepGroup[];
  /** The builder's current steps: an edit can save them over a group's. */
  builderSequence: unknown[];
  /** Puts a group's steps in the builder in place of what is there. */
  onOpenInBuilder: (group: WebStepGroup) => void;
}

interface Caller {
  id: number;
  name: string;
}

interface Draft {
  id: string;
  name: string;
  description: string;
  replaceSteps: boolean;
}

export const STEP_GROUPS_QUERY_KEY = ['stepGroups'] as const;
export const stepGroupUsageKey = (id: string) => [...STEP_GROUPS_QUERY_KEY, id, 'usage'] as const;

async function fetchUsage(id: string): Promise<Caller[]> {
  const res = await fetch(`/api/step-groups/${id}/usage`);
  if (!res.ok) throw new Error('Could not load the step group usage');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** The server's sentence, with the tests it names when it refuses because of them. */
async function errorOf(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  const detail = body?.details?.fieldErrors
    ? Object.values(body.details.fieldErrors as Record<string, string[]>)
        .flat()
        .join(' ')
    : '';
  const users = Array.isArray(body?.tests) ? ` ${body.tests.join(', ')}` : '';
  return new Error(`${body?.error || fallback}${detail ? ` ${detail}` : ''}${users}`);
}

/** The names of the tests that call a group, as a list a sentence can hold. */
function UsageList({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const usage = useQuery<Caller[], Error>({
    queryKey: stepGroupUsageKey(groupId),
    queryFn: () => fetchUsage(groupId),
  });

  if (usage.isLoading)
    return (
      <p className="text-sm text-muted-foreground">
        {t('stepGroupsManager.usageLoading', 'Finding the tests that call it…')}
      </p>
    );
  if (usage.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('stepGroupsManager.usageFailed', 'Could not find out which tests call it.')}
      </p>
    );
  const callers = usage.data ?? [];
  if (callers.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t('stepGroupsManager.usageNone', 'No test calls this group yet.')}
      </p>
    );
  return (
    <div className="text-sm">
      <p className="text-muted-foreground">
        {t('stepGroupsManager.usage', 'Called by {{count}} tests:', { count: callers.length })}
      </p>
      <ul className="mt-1 list-disc pl-5">
        {callers.map((caller) => (
          <li key={caller.id}>{caller.name}</li>
        ))}
      </ul>
    </div>
  );
}

const StepGroupsManager: React.FC<StepGroupsManagerProps> = ({
  open,
  onOpenChange,
  groups,
  builderSequence,
  onOpenInBuilder,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [usageFor, setUsageFor] = useState<string | null>(null);
  const [opening, setOpening] = useState<WebStepGroup | null>(null);
  const [removing, setRemoving] = useState<WebStepGroup | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      const response = await fetch(`/api/step-groups/${value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: value.name.trim(),
          description: value.description.trim() || null,
          ...(value.replaceSteps ? { sequence: builderSequence } : {}),
        }),
      });
      if (!response.ok)
        throw await errorOf(
          response,
          t('stepGroupsManager.saveFailed', 'Could not save the step group.'),
        );
      return (await response.json()) as WebStepGroup;
    },
    onSuccess: (updated) => {
      setDraft(null);
      setError('');
      toast({
        title: t('stepGroupsManager.saved.title', 'Step group saved'),
        description: t(
          'stepGroupsManager.saved.description',
          'Every test that calls “{{name}}” runs the new version from its next run.',
          { name: updated.name },
        ),
      });
      queryClient.invalidateQueries({ queryKey: STEP_GROUPS_QUERY_KEY });
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const remove = useMutation({
    mutationFn: async (group: WebStepGroup) => {
      const response = await fetch(`/api/step-groups/${group.id}`, { method: 'DELETE' });
      if (!response.ok)
        throw await errorOf(
          response,
          t('stepGroupsManager.deleteFailed', 'Could not delete the step group.'),
        );
    },
    onSuccess: () => {
      setError('');
      toast({ title: t('stepGroupsManager.deleted.title', 'Step group deleted') });
      queryClient.invalidateQueries({ queryKey: STEP_GROUPS_QUERY_KEY });
    },
    onError: (removeError: Error) => setError(removeError.message),
    onSettled: () => setRemoving(null),
  });

  /**
   * Asks which tests call the group before offering to delete it. The server refuses while any
   * does (409), and naming them here, before the question, is better than a refusal after it.
   */
  const askToDelete = async (group: WebStepGroup) => {
    setError('');
    setCheckingId(group.id);
    try {
      const callers = await queryClient.fetchQuery({
        queryKey: stepGroupUsageKey(group.id),
        queryFn: () => fetchUsage(group.id),
      });
      if (callers.length > 0) {
        setError(
          t(
            'stepGroupsManager.blocked',
            '“{{name}}” cannot be deleted while tests still call it: {{tests}}. Take the call out of those tests first.',
            { name: group.name, tests: callers.map((caller) => caller.name).join(', ') },
          ),
        );
        return;
      }
      setRemoving(group);
    } catch {
      setError(t('stepGroupsManager.usageFailed', 'Could not find out which tests call it.'));
    } finally {
      setCheckingId(null);
    }
  };

  const openInBuilder = (group: WebStepGroup) => {
    setOpening(null);
    onOpenInBuilder(group);
    onOpenChange(false);
    toast({
      title: t('stepGroupsManager.opened.title', 'Step group opened'),
      description: t(
        'stepGroupsManager.opened.description',
        'Its steps are in the builder. When they are right, edit “{{name}}” here and tick “Replace its steps”.',
        { name: group.name },
      ),
    });
  };

  const submitDraft = () => {
    if (!draft) return;
    if (draft.name.trim() === '') {
      setError(t('stepGroupsManager.nameRequired', 'A step group needs a name.'));
      return;
    }
    save.mutate(draft);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            setDraft(null);
            setError('');
          }
          onOpenChange(value);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" aria-hidden />
              {t('stepGroupsManager.title', 'Step groups')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'stepGroupsManager.description',
                'A test that calls a group runs whatever the group holds at the time, so a change here reaches every test that calls it on its next run.',
              )}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'stepGroupsManager.empty',
                'No step groups yet. Save the builder’s steps as a group to make one.',
              )}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {groups.map((group) => {
                const isEditing = draft?.id === group.id;
                return (
                  <li key={group.id} className="space-y-2 p-3">
                    {isEditing ? (
                      <form
                        className="space-y-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitDraft();
                        }}
                      >
                        <div className="grid gap-1">
                          <Label htmlFor={`step-group-name-${group.id}`}>
                            {t('stepGroupsManager.nameLabel', 'Name')}
                          </Label>
                          <Input
                            id={`step-group-name-${group.id}`}
                            value={draft.name}
                            maxLength={120}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`step-group-description-${group.id}`}>
                            {t('stepGroupsManager.descriptionLabel', 'Description')}
                          </Label>
                          <Textarea
                            id={`step-group-description-${group.id}`}
                            value={draft.description}
                            maxLength={500}
                            rows={2}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          />
                        </div>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={`step-group-replace-${group.id}`}
                            checked={draft.replaceSteps}
                            disabled={builderSequence.length === 0}
                            onCheckedChange={(checked) =>
                              setDraft({ ...draft, replaceSteps: checked === true })
                            }
                          />
                          <div className="grid gap-1">
                            <Label htmlFor={`step-group-replace-${group.id}`}>
                              {t(
                                'stepGroupsManager.replaceSteps',
                                'Replace its steps with the {{count}} steps now in the builder',
                                { count: builderSequence.length },
                              )}
                            </Label>
                            {builderSequence.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                {t(
                                  'stepGroupsManager.replaceStepsEmpty',
                                  'To change its steps, open it in the builder, edit them there, then tick this.',
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={save.isPending}>
                            {save.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            {t('common.save', 'Save')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={save.isPending}
                            onClick={() => {
                              setDraft(null);
                              setError('');
                            }}
                          >
                            <X className="mr-2 h-4 w-4" />
                            {t('common.cancel', 'Cancel')}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-medium">
                            <span className="truncate">{group.name}</span>
                            <Badge variant="secondary" className="shrink-0">
                              {t('stepGroupsManager.stepCount', '{{count}} steps', {
                                count: group.sequence?.length ?? 0,
                              })}
                            </Badge>
                          </p>
                          {group.description && (
                            <p className="text-sm text-muted-foreground">{group.description}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-pressed={usageFor === group.id}
                            onClick={() => setUsageFor(usageFor === group.id ? null : group.id)}
                          >
                            <ListTree className="mr-1 h-4 w-4" />
                            {usageFor === group.id
                              ? t('stepGroupsManager.hideUsage', 'Hide')
                              : t('stepGroupsManager.whereUsed', 'Where used')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              builderSequence.length > 0 ? setOpening(group) : openInBuilder(group)
                            }
                          >
                            <Layers className="mr-1 h-4 w-4" />
                            {t('stepGroupsManager.openInBuilder', 'Open in builder')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('stepGroupsManager.edit', 'Edit')}
                            onClick={() => {
                              setError('');
                              setDraft({
                                id: group.id,
                                name: group.name,
                                description: group.description ?? '',
                                replaceSteps: false,
                              });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.delete', 'Delete')}
                            disabled={checkingId === group.id || remove.isPending}
                            onClick={() => void askToDelete(group)}
                          >
                            {checkingId === group.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                    {usageFor === group.id && <UsageList groupId={group.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={opening !== null}
        onOpenChange={(value) => {
          if (!value) setOpening(null);
        }}
        title={t('stepGroupsManager.openDialog.title', 'Open “{{name}}” in the builder?', {
          name: opening?.name ?? '',
        })}
        description={t(
          'stepGroupsManager.openDialog.description',
          'The {{count}} steps now in the builder are replaced by the group’s. Save them as a test or a group first to keep them.',
          { count: builderSequence.length },
        )}
        confirmLabel={t('stepGroupsManager.openInBuilder', 'Open in builder')}
        onConfirm={() => {
          if (opening) openInBuilder(opening);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => {
          if (!value && !remove.isPending) setRemoving(null);
        }}
        title={t('stepGroupsManager.deleteDialog.title', 'Delete step group “{{name}}”?', {
          name: removing?.name ?? '',
        })}
        description={t(
          'stepGroupsManager.deleteDialog.description',
          'It leaves the palette. No test calls it, so nothing else changes. This cannot be undone.',
        )}
        confirmLabel={t('common.delete', 'Delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </>
  );
};

export default StepGroupsManager;
