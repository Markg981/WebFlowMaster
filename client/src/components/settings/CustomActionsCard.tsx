import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Pencil, Plus, Puzzle, Save, Trash2, X } from 'lucide-react';
import { argumentsHint, type CustomActionParameter } from '@shared/custom-actions';

/**
 * The organization's own steps: JavaScript with a name and parameters, run in the page under
 * test. Written here once, dragged into tests from the builder's palette.
 */

interface CustomAction {
  id: string;
  name: string;
  description: string | null;
  parameters: CustomActionParameter[];
  script: string;
  updatedAt: string;
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  /** "code, qty?" — a trailing ? marks a parameter that may be left out. */
  parameters: string;
  script: string;
}

const EMPTY: Draft = { id: null, name: '', description: '', parameters: '', script: '' };

export function parseParameterList(text: string): CustomActionParameter[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part.replace(/\?$/, '').trim(), required: !part.endsWith('?') }));
}

function formatParameterList(parameters: CustomActionParameter[]): string {
  return parameters.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ');
}

const CustomActionsCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const { data: actions = [], isLoading } = useQuery<CustomAction[], Error>({
    queryKey: ['customActions'],
    queryFn: async () => {
      const response = await fetch('/api/custom-actions');
      if (!response.ok) throw new Error('Could not load the custom actions');
      return response.json();
    },
  });

  const errorOf = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => ({}));
    const detail = body?.details?.fieldErrors ? Object.values(body.details.fieldErrors).flat().join(' ') : '';
    const users = Array.isArray(body?.tests) ? ` ${body.tests.join(', ')}` : '';
    return new Error(`${body.error || fallback}${detail ? ` ${detail}` : ''}${users}`);
  };

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      const response = await fetch(value.id ? `/api/custom-actions/${value.id}` : '/api/custom-actions', {
        method: value.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: value.name,
          description: value.description || null,
          parameters: parseParameterList(value.parameters),
          script: value.script,
        }),
      });
      if (!response.ok) throw await errorOf(response, 'Could not save the custom action');
      return response.json();
    },
    onSuccess: () => {
      setDraft(null);
      setMessage({ kind: 'info', text: t('settings.customActions.saved', 'Saved. Every test that uses it runs the new version.') });
      queryClient.invalidateQueries({ queryKey: ['customActions'] });
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/custom-actions/${id}`, { method: 'DELETE' });
      if (!response.ok) throw await errorOf(response, 'Could not delete the custom action');
    },
    onSuccess: () => {
      setMessage(null);
      queryClient.invalidateQueries({ queryKey: ['customActions'] });
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="h-5 w-5" aria-hidden />
          {t('settings.customActions.title', 'Custom actions')}
        </CardTitle>
        <CardDescription>
          {t(
            'settings.customActions.description',
            'Steps of your own, in JavaScript that runs in the page under test. The script reads its arguments as args and the step’s element as element; it fails the step by throwing or returning false.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {message.text}
          </p>
        )}

        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label={t('common.loading', 'Loading')} />
        ) : actions.length === 0 && !draft ? (
          <p className="text-sm text-muted-foreground">{t('settings.customActions.empty', 'No custom actions yet.')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {actions.map((action) => (
              <li key={action.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{action.name}</p>
                  {action.description && <p className="text-sm text-muted-foreground">{action.description}</p>}
                  {action.parameters.length > 0 && (
                    <Badge variant="secondary" className="mt-1 font-mono text-[11px]">{argumentsHint(action.parameters)}</Badge>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.customActions.edit', 'Edit')}
                    onClick={() => setDraft({
                      id: action.id,
                      name: action.name,
                      description: action.description ?? '',
                      parameters: formatParameterList(action.parameters),
                      script: action.script,
                    })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.customActions.delete', 'Delete')}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(t('settings.customActions.confirmDelete', 'Delete “{{name}}”? A test that still uses it cannot run.', { name: action.name }))) {
                        remove.mutate(action.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <form
            className="space-y-3 rounded-md border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(draft);
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="custom-action-name">{t('settings.customActions.name', 'Name')}</Label>
              <Input id="custom-action-name" value={draft.name} maxLength={120} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="custom-action-description">{t('settings.customActions.descriptionLabel', 'Description')}</Label>
              <Input id="custom-action-description" value={draft.description} maxLength={500} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="custom-action-parameters">{t('settings.customActions.parameters', 'Parameters')}</Label>
              <Input
                id="custom-action-parameters"
                className="font-mono"
                value={draft.parameters}
                placeholder="code, qty?"
                onChange={(e) => setDraft({ ...draft, parameters: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.customActions.parametersHint', 'Separated by commas; a trailing ? makes one optional. In a test: code=4711; qty=2.')}
              </p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="custom-action-script">{t('settings.customActions.script', 'Script')}</Label>
              <Textarea
                id="custom-action-script"
                className="min-h-[160px] font-mono text-xs"
                value={draft.script}
                required
                placeholder={"const row = [...document.querySelectorAll('tr')].find(r => r.textContent.includes(args.code));\nif (!row) throw new Error('No row ' + args.code);\nrow.querySelector('button').click();"}
                onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {t('settings.customActions.save', 'Save')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                <X className="mr-2 h-4 w-4" />
                {t('settings.customActions.cancel', 'Cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => { setMessage(null); setDraft(EMPTY); }}>
            <Plus className="mr-2 h-4 w-4" />
            {t('settings.customActions.new', 'New custom action')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomActionsCard;
