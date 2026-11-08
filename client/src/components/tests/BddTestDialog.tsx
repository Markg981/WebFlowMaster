import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BddTest } from '@shared/bdd';
import { bddRequest, type BddProfile } from '@/lib/api/bdd';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
export interface BddDraftSource {
  id: number;
  name: string;
  projectId?: number | null;
  bdd: BddTest;
  /** When the test was loaded: sent back so a save over someone else's edit is refused (M-07). */
  updatedAt?: string;
}
export default function BddTestDialog({
  test,
  onClose,
  onSaved,
}: {
  test: BddDraftSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(test.bdd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    setDraft(test.bdd);
    setError('');
    setConflict(false);
    setBusy(false);
    generation.current++;
    return () => {
      // A counter, not a DOM node: reading its value at cleanup is the point. Every answer that
      // arrives for an older generation is dropped.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [test.id, test.bdd]);
  const { data, error: profilesError } = useQuery<{ profiles: BddProfile[] }>({
    queryKey: ['/api/bdd/profiles'],
    queryFn: () => bddRequest('/api/bdd/profiles'),
  });
  const profiles = (data?.profiles ?? []).filter(
    (p) => p.projectId === null || p.projectId === (test.projectId ?? null),
  );
  const selected = profiles.find(
    (p) => p.id === draft.binding?.id && p.revision === draft.binding?.revision,
  );
  const draftIdentity = (value: BddTest) =>
    JSON.stringify([
      value.source,
      value.language,
      value.uri,
      value.scenarioLine,
      value.exampleLine,
      value.mode,
      value.binding?.id,
      value.binding?.revision,
    ]);
  const dirty = draftIdentity(draft) !== draftIdentity(test.bdd);
  const patch = (next: Partial<BddTest>) => {
    if (busy) return;
    setDraft((current) => ({ ...current, ...next }));
    setError('');
  };
  const save = async (convert = false, overwrite = false) => {
    if (busy || (convert && dirty)) return;
    const requestGeneration = generation.current;
    setBusy(true);
    setError('');
    try {
      await bddRequest(`/api/tests/${test.id}`, 'PUT', {
        ...(convert
          ? { bdd: null }
          : { bdd: { ...draft, ...(draft.mode === 'manual' ? { binding: undefined } : {}) } }),
        ...(test.updatedAt && !overwrite ? { expectedUpdatedAt: test.updatedAt } : {}),
      });
      if (generation.current === requestGeneration) {
        onSaved();
        onClose();
      }
    } catch (e) {
      if (generation.current !== requestGeneration) return;
      if ((e as { code?: string }).code === 'test_changed') setConflict(true);
      else setError((e as Error).message);
    } finally {
      if (generation.current === requestGeneration) setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="bdd-editor">
          <DialogHeader>
            <DialogTitle>{test.name}</DialogTitle>
            <DialogDescription>
              {t(
                'bdd.sourceDescription',
                'Edit source and scenario selection together. Saving validates Gherkin and regenerates steps.',
              )}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="bdd-source">{t('bdd.source', 'Gherkin source')}</Label>
          <Textarea
            id="bdd-source"
            disabled={busy}
            rows={14}
            className="font-mono text-xs"
            value={draft.source}
            onChange={(e) => patch({ source: e.target.value })}
            data-testid="bdd-source"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bdd-language">{t('bdd.language', 'Dialect')}</Label>
              <Input
                id="bdd-language"
                disabled={busy}
                value={draft.language}
                onChange={(e) => patch({ language: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bdd-uri">{t('bdd.uri', 'Logical feature filename')}</Label>
              <Input
                id="bdd-uri"
                disabled={busy}
                value={draft.uri}
                onChange={(e) => patch({ uri: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bdd-scenario-line">{t('bdd.scenarioLine', 'Scenario line')}</Label>
              <Input
                id="bdd-scenario-line"
                disabled={busy}
                type="number"
                min={1}
                value={draft.scenarioLine}
                onChange={(e) => patch({ scenarioLine: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="bdd-example-line">
                {t('bdd.exampleLine', 'Examples row line (optional)')}
              </Label>
              <Input
                id="bdd-example-line"
                disabled={busy}
                type="number"
                min={1}
                value={draft.exampleLine ?? ''}
                onChange={(e) =>
                  patch({ exampleLine: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </div>
          </div>
          <Label htmlFor="bdd-mode">{t('bdd.mode', 'Execution mode')}</Label>
          <select
            id="bdd-mode"
            disabled={busy}
            className="border rounded p-2 bg-background"
            value={draft.mode}
            onChange={(e) => patch({ mode: e.target.value as BddTest['mode'], binding: undefined })}
          >
            <option value="manual">{t('bdd.manual', 'Manual')}</option>
            <option value="cucumber">{t('bdd.cucumber', 'Cucumber')}</option>
          </select>
          {draft.mode === 'cucumber' && (
            <>
              <Label htmlFor="bdd-profile">{t('bdd.profile', 'Execution profile')}</Label>
              <select
                id="bdd-profile"
                disabled={busy}
                data-testid="bdd-profile"
                className="border rounded p-2 bg-background"
                value={selected?.id ?? ''}
                onChange={(e) => {
                  const p = profiles.find((p) => p.id === e.target.value);
                  patch({ binding: p ? { id: p.id, revision: p.revision } : undefined });
                }}
              >
                <option value="">{t('bdd.selectProfile', 'Select an authorized profile')}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.revision}
                  </option>
                ))}
              </select>
              {!selected && draft.binding && (
                <p role="alert">
                  {t(
                    'bdd.staleBinding',
                    'This profile or revision is unavailable. Select a current profile and publish the updated test.',
                  )}
                </p>
              )}
            </>
          )}
          {profilesError && <p role="alert">{profilesError.message}</p>}
          {dirty && (
            <p className="text-sm text-muted-foreground">
              {t(
                'bdd.saveBeforeConvert',
                'Save your changes before converting to an editable manual test.',
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive" data-testid="bdd-editor-error">
              {error}
            </p>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() => save(true)}
              data-testid="bdd-convert-manual"
            >
              {t('bdd.convertManual', 'Convert to editable manual test')}
            </Button>
            <Button
              disabled={busy || !draft.source.trim() || (draft.mode === 'cucumber' && !selected)}
              onClick={() => save()}
              data-testid="bdd-save"
            >
              {t('bdd.saveValidate', 'Save and validate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={conflict}
        onOpenChange={setConflict}
        title={t('testConflict.title', 'This test was changed by someone else')}
        description={t(
          'testConflict.description',
          'Someone saved this test after you opened it. Keep editing to review your draft (close the editor and reopen it to load their version), or overwrite their changes with yours.',
        )}
        confirmLabel={t('testConflict.overwrite', 'Overwrite')}
        cancelLabel={t('testConflict.keepEditing', 'Keep editing')}
        destructive
        pending={busy}
        onConfirm={() => {
          setConflict(false);
          void save(false, true);
        }}
      />
    </>
  );
}
