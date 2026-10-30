import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import {
  HUB_IMPORT_MAX_CASES,
  hubErrorMessage,
  useImportHubCases,
  type HubImportResult,
  type HubSkipReason,
} from '@/hooks/useTestCaseHub';

/**
 * The last step of an import: where the new tests go, and which wording they take.
 *
 * A hub case has two sets of steps, the ordinary ones and the ones for the reference
 * environment; the person chooses once for the whole batch. The result stays in the dialog
 * until it is closed, so a skipped case and its reason are read, not flashed in a toast.
 */

interface ProjectOption {
  id: number;
  name: string;
}

interface SuiteOption {
  id: number;
  name: string;
  kind: 'static' | 'dynamic';
  projectId: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseIds: string[];
  onImported?: (result: HubImportResult) => void;
}

const NONE = 'none';
const NEW_SUITE = 'new';

async function list<T>(url: string): Promise<T> {
  const response = await apiRequest('GET', url);
  return (await response.json()) as T;
}

const HubImportDialog: React.FC<Props> = ({ open, onOpenChange, caseIds, onImported }) => {
  const { t } = useTranslation();
  const importCases = useImportHubCases();

  const [projectId, setProjectId] = useState(NONE);
  const [suiteChoice, setSuiteChoice] = useState(NONE);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [variant, setVariant] = useState<'standard' | 'reference'>('standard');
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<HubImportResult | null>(null);

  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ['/api/projects'],
    queryFn: () => list<ProjectOption[]>('/api/projects'),
    enabled: open,
  });
  const { data: suites = [] } = useQuery<SuiteOption[]>({
    queryKey: ['/api/suites'],
    queryFn: () => list<SuiteOption[]>('/api/suites'),
    enabled: open,
  });
  // A dynamic suite is a tag query, so nothing can be placed in it by hand.
  const staticSuites = suites.filter((suite) => suite.kind === 'static');

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setResult(null);
    setNewSuiteName('');
    setSuiteChoice(NONE);
  }, [open]);

  const tooMany = caseIds.length > HUB_IMPORT_MAX_CASES;

  const submit = () => {
    if (suiteChoice === NEW_SUITE && newSuiteName.trim() === '') {
      setFormError(t('testCaseHub.import.suiteNameRequired', 'Give the new suite a name.'));
      return;
    }
    setFormError('');
    importCases.mutate(
      {
        caseIds,
        projectId: projectId === NONE ? null : Number(projectId),
        ...(suiteChoice === NEW_SUITE
          ? { newSuiteName: newSuiteName.trim() }
          : suiteChoice !== NONE
            ? { suiteId: Number(suiteChoice) }
            : {}),
        variant,
      },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
          onImported?.(outcome);
        },
        onError: (error) => setFormError(hubErrorMessage(error, t)),
      },
    );
  };

  const reasonLabel = (reason: HubSkipReason | undefined) => {
    switch (reason) {
      case 'name_conflict':
        return t('testCaseHub.import.reason.name_conflict', 'A test with this name exists already');
      case 'not_manual':
        return t('testCaseHub.import.reason.not_manual', 'The imported test was automated since');
      case 'missing_in_hub':
        return t('testCaseHub.import.reason.missing_in_hub', 'No longer in the hub');
      default:
        return t('testCaseHub.import.reason.not_in_catalog', 'Not in the catalog');
    }
  };

  const skipped = result?.cases.filter((entry) => entry.outcome === 'skipped') ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('testCaseHub.import.title', {
              defaultValue: 'Import {{count}} test cases',
              count: caseIds.length,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'testCaseHub.import.description',
              'Each case becomes a manual test in the library, ready for a plan. A case imported before is updated as a new version if the hub changed it, and left alone otherwise.',
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" data-testid="hub-import-result">
            <ul className="grid grid-cols-2 gap-2">
              <li>
                <span className="font-medium tabular-nums">{result.created}</span>{' '}
                {t('testCaseHub.import.result.created', 'created')}
              </li>
              <li>
                <span className="font-medium tabular-nums">{result.updated}</span>{' '}
                {t('testCaseHub.import.result.updated', 'updated')}
              </li>
              <li>
                <span className="font-medium tabular-nums">{result.unchanged}</span>{' '}
                {t('testCaseHub.import.result.unchanged', 'already up to date')}
              </li>
              <li>
                <span className="font-medium tabular-nums">{result.skipped}</span>{' '}
                {t('testCaseHub.import.result.skipped', 'skipped')}
              </li>
            </ul>
            {skipped.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {skipped.map((entry) => (
                  <li key={entry.caseId} className="flex justify-between gap-3">
                    <code className="text-xs">{entry.caseId}</code>
                    <span className="text-muted-foreground">{reasonLabel(entry.reason)}</span>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link href="/tests">{t('testCaseHub.import.openLibrary', 'Open the library')}</Link>
              </Button>
              <Button onClick={() => onOpenChange(false)}>{t('common.close', 'Close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="hubImportProject">{t('testCaseHub.import.project', 'Project')}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="hubImportProject" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t('testCaseHub.import.noProject', 'No project')}
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="hubImportSuite">{t('testCaseHub.import.suite', 'Suite')}</Label>
              <Select value={suiteChoice} onValueChange={setSuiteChoice}>
                <SelectTrigger id="hubImportSuite" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t('testCaseHub.import.noSuite', 'No suite')}
                  </SelectItem>
                  <SelectItem value={NEW_SUITE}>
                    {t('testCaseHub.import.newSuite', 'A new suite…')}
                  </SelectItem>
                  {staticSuites.map((suite) => (
                    <SelectItem key={suite.id} value={String(suite.id)}>
                      {suite.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {suiteChoice === NEW_SUITE && (
                <Input
                  className="mt-2"
                  value={newSuiteName}
                  onChange={(event) => setNewSuiteName(event.target.value)}
                  placeholder={t('testCaseHub.import.suiteNamePlaceholder', 'Archive — smoke')}
                  aria-label={t('testCaseHub.import.suiteName', 'Suite name')}
                />
              )}
            </div>

            <div>
              <Label>{t('testCaseHub.import.variant', 'Steps to take')}</Label>
              <RadioGroup
                className="mt-2 gap-2"
                value={variant}
                onValueChange={(value) => setVariant(value as 'standard' | 'reference')}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="standard" id="hubVariantStandard" className="mt-0.5" />
                  <Label htmlFor="hubVariantStandard" className="font-normal">
                    {t('testCaseHub.import.variantStandard', 'Standard steps')}
                    <span className="block text-xs text-muted-foreground">
                      {t(
                        'testCaseHub.import.variantStandardHint',
                        'The steps and expected outcome as the hub writes them.',
                      )}
                    </span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="reference" id="hubVariantReference" className="mt-0.5" />
                  <Label htmlFor="hubVariantReference" className="font-normal">
                    {t('testCaseHub.import.variantReference', 'Reference environment steps')}
                    <span className="block text-xs text-muted-foreground">
                      {t(
                        'testCaseHub.import.variantReferenceHint',
                        'The variant written for the reference environment, where a case has one; the standard steps otherwise.',
                      )}
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {tooMany && (
              <p className="text-sm text-destructive">
                {t('testCaseHub.import.tooMany', {
                  defaultValue: 'At most {{max}} cases per import. Narrow the selection.',
                  max: HUB_IMPORT_MAX_CASES,
                })}
              </p>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={submit}
                disabled={importCases.isPending || tooMany || caseIds.length === 0}
                data-testid="hub-import-confirm"
              >
                {importCases.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('testCaseHub.import.confirm', {
                  defaultValue: 'Import {{count}} cases',
                  count: caseIds.length,
                })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HubImportDialog;
