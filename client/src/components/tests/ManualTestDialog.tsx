import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { manualStepsOf, toSequence, type ManualStep } from '@shared/manual-tests';
import GherkinArguments from './GherkinArguments';

/**
 * Writing a manual test: a name and the steps a person performs, each with what should happen.
 *
 * Saved as an ordinary test (shared/manual-tests.ts), so it has versions, tags and a place in
 * plans like any other; in a run it waits for somebody's verdict in the report.
 */

export interface ManualTestDraftSource {
  id: number;
  name: string;
  sequence?: unknown;
  bdd?: unknown;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The test being edited; absent to write a new one. */
  test: ManualTestDraftSource | null;
  onSaved: () => void;
}

const EMPTY_STEP: ManualStep = { action: '', expected: '' };

export const ManualTestDialog: React.FC<Props> = ({ isOpen, onClose, test, onSaved }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<ManualStep[]>([EMPTY_STEP]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(test?.name ?? '');
    const existing = test ? manualStepsOf(test.sequence) : [];
    setSteps(existing.length > 0 ? existing : [EMPTY_STEP]);
    setError(null);
  }, [isOpen, test]);

  const update = (index: number, patch: Partial<ManualStep>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const move = (index: number, by: number) =>
    setSteps((current) => {
      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(index + by, 0, step);
      return next;
    });

  const save = async () => {
    if(test?.bdd)return;
    const written = steps.map((step) => ({ ...step, action: step.action.trim(), expected: step.expected.trim() })).filter((step) => step.action !== '');
    if (name.trim() === '') return setError(t('manualTests.errors.name', 'Give the test a name.'));
    if (written.length === 0) return setError(t('manualTests.errors.steps', 'Write at least one step.'));
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(test ? `/api/tests/${test.id}` : '/api/tests', {
        method: test ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No address and no elements: nothing is opened in a browser.
        body: JSON.stringify({ name: name.trim(), url: '', sequence: toSequence(written).map((step,i)=>({...step,...(written[i].gherkin?{gherkin:written[i].gherkin}:{})})), elements: [] }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          response.status === 409
            ? t('manualTests.errors.duplicate', 'A test with this name already exists.')
            : body.error || t('manualTests.errors.save', 'Could not save the test.'),
        );
      }
      onSaved();
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message ?? String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if(test?.bdd)return <Dialog open={isOpen} onOpenChange={open=>{if(!open)onClose();}}><DialogContent><DialogHeader><DialogTitle>{test.name}</DialogTitle></DialogHeader><p role="alert">{t('bdd.editSourceRequired','Use the Gherkin source editor to change a source-derived BDD test.')}</p></DialogContent></Dialog>;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{test ? t('manualTests.editTitle', 'Edit manual test') : t('manualTests.newTitle', 'New manual test')}</DialogTitle>
          <DialogDescription>
            {t('manualTests.description', 'The steps a person performs, each with the result to expect. In a plan run it waits for a verdict in the report.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1">
          <Label htmlFor="manual-test-name">{t('manualTests.name', 'Name')}</Label>
          <Input id="manual-test-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </div>

        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{t('manualTests.step', 'Step {{n}}', { n: index + 1 })}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('manualTests.moveUp', 'Move up')}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={index === steps.length - 1} onClick={() => move(index, 1)} aria-label={t('manualTests.moveDown', 'Move down')}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((_, i) => i !== index))} aria-label={t('manualTests.removeStep', 'Remove step')}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor={`manual-action-${index}`} className="text-xs">{t('manualTests.action', 'Action')}</Label>
                  <Textarea id={`manual-action-${index}`} value={step.action} onChange={(e) => update(index, { action: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`manual-expected-${index}`} className="text-xs">{t('manualTests.expected', 'Expected result')}</Label>
                  <Textarea id={`manual-expected-${index}`} value={step.expected} onChange={(e) => update(index, { expected: e.target.value })} />
                </div>
              </div>
              <GherkinArguments argument={step.gherkin}/>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={() => setSteps((current) => [...current, EMPTY_STEP])}>
          <Plus className="mr-2 h-4 w-4" />
          {t('manualTests.addStep', 'Add step')}
        </Button>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('manualTests.cancel', 'Cancel')}</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('manualTests.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualTestDialog;
