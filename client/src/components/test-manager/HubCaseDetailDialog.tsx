import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import type { ManualStep } from '@shared/manual-tests';
import { formatDateTime } from '@/lib/dates';
import { hubErrorMessage, useHubCase, type HubCaseDetail } from '@/hooks/useTestCaseHub';
import { HubCaseStateBadge } from './HubCaseStateBadge';

/**
 * One hub case in full, and the manual test it would become.
 *
 * The preview is the same conversion the import runs, so what the person reads here is what
 * lands in the library — numbered steps paired with their expected outcomes, the precondition
 * first.
 */

interface Props {
  caseId: string | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  onImport: (caseId: string) => void;
}

function StepsPreview({ steps }: { steps: ManualStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li key={index} className="rounded-md border p-2 text-sm">
          <p className="whitespace-pre-wrap">
            <span className="mr-1 tabular-nums text-muted-foreground">{index + 1}.</span>
            {step.action}
          </p>
          {step.expected && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
              → {step.expected}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm" title={typeof value === 'string' ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}

const HubCaseDetailDialog: React.FC<Props> = ({ caseId, onOpenChange, canEdit, onImport }) => {
  const { t, i18n } = useTranslation();
  const { data, isLoading, error } = useHubCase(caseId);
  const [variant, setVariant] = useState<'standard' | 'reference'>('standard');

  const detail: HubCaseDetail | undefined = data;
  const missing = detail?.missingSince != null;

  return (
    <Dialog open={caseId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <code className="text-base">{caseId}</code>
            {detail && <HubCaseStateBadge row={detail} />}
            {detail?.status === 'deprecated' && (
              <Badge variant="outline">{t('testCaseHub.status.deprecated', 'Deprecated')}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail?.featureHighlight ||
              t('testCaseHub.detail.description', 'As the hub holds it at the last refresh.')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('testCaseHub.loading', 'Loading…')}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{hubErrorMessage(error, t)}</p>
        ) : detail ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
              <Fact label={t('testCaseHub.columns.module', 'Module')} value={detail.module} />
              <Fact
                label={t('testCaseHub.detail.executionModule', 'Executed in')}
                value={detail.executionModule}
              />
              <Fact label={t('testCaseHub.columns.priority', 'Priority')} value={detail.priority} />
              <Fact
                label={t('testCaseHub.columns.readiness', 'Readiness')}
                value={t(`testCaseHub.readiness.${detail.readinessLevel}`, {
                  defaultValue: `Level ${detail.readinessLevel}`,
                })}
              />
              <Fact
                label={t('testCaseHub.detail.versions', 'Versions')}
                value={
                  detail.versionFrom || detail.versionTo
                    ? `${detail.versionFrom ?? '…'} → ${detail.versionTo ?? '…'}`
                    : null
                }
              />
              <Fact
                label={t('testCaseHub.detail.executionGroup', 'Execution group')}
                value={detail.executionGroup}
              />
              <Fact label={t('testCaseHub.detail.sme', 'SME')} value={detail.sme} />
              <Fact label={t('testCaseHub.detail.devopsId', 'DevOps id')} value={detail.devopsId} />
              <Fact
                label={t('testCaseHub.detail.dependsOn', 'Depends on')}
                value={detail.dependsOn.length > 0 ? detail.dependsOn.join(', ') : null}
              />
              <Fact
                label={t('testCaseHub.detail.sourceUpdatedAt', 'Updated in the hub')}
                value={
                  detail.sourceUpdatedAt
                    ? formatDateTime(detail.sourceUpdatedAt, i18n.language)
                    : null
                }
              />
            </dl>

            <section>
              <h4 className="text-sm font-medium">
                {t('testCaseHub.detail.objective', 'Functional objective')}
              </h4>
              <p className="mt-1 whitespace-pre-wrap text-sm">{detail.functionalObjective}</p>
            </section>

            <section className="rounded-md border bg-muted/40 p-3 text-sm">
              {detail.test ? (
                <p>
                  {detail.changedSinceImport
                    ? t(
                        'testCaseHub.detail.importedChanged',
                        'Imported, and changed in the hub since. Importing again updates the test as a new version.',
                      )
                    : t('testCaseHub.detail.imported', 'Imported as a manual test:')}{' '}
                  <Link
                    href={`/tests?search=${encodeURIComponent(`[${detail.caseId}]`)}`}
                    className="underline"
                  >
                    {detail.test.name}
                  </Link>
                </p>
              ) : missing ? (
                <p className="text-destructive">
                  {t('testCaseHub.detail.missing', {
                    defaultValue: 'No longer in the hub since {{date}}. It cannot be imported.',
                    date: formatDateTime(detail.missingSince as string, i18n.language),
                  })}
                </p>
              ) : (
                <p>
                  {t('testCaseHub.detail.notImported', 'Not imported yet. It would be named')}{' '}
                  <span className="font-medium">{detail.testName}</span>
                </p>
              )}
            </section>

            <section>
              <h4 className="text-sm font-medium">
                {t('testCaseHub.detail.preview', 'Steps of the manual test')}
              </h4>
              {detail.preview.reference ? (
                <Tabs
                  value={variant}
                  onValueChange={(value) => setVariant(value as 'standard' | 'reference')}
                  className="mt-2"
                >
                  <TabsList>
                    <TabsTrigger value="standard">
                      {t('testCaseHub.import.variantStandard', 'Standard steps')}
                    </TabsTrigger>
                    <TabsTrigger value="reference">
                      {t('testCaseHub.import.variantReference', 'Reference environment steps')}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="standard">
                    <StepsPreview steps={detail.preview.standard} />
                  </TabsContent>
                  <TabsContent value="reference">
                    <StepsPreview steps={detail.preview.reference} />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="mt-2">
                  <StepsPreview steps={detail.preview.standard} />
                </div>
              )}
            </section>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close', 'Close')}
              </Button>
              {canEdit && !missing && (
                <Button onClick={() => onImport(detail.caseId)} data-testid="hub-detail-import">
                  {detail.test
                    ? t('testCaseHub.detail.importAgain', 'Import again')
                    : t('testCaseHub.detail.import', 'Import this case')}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default HubCaseDetailDialog;
