import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { HubCaseRow } from '@/hooks/useTestCaseHub';

/** Where a hub case stands against the library: not imported, imported, changed since, gone. */
export function HubCaseStateBadge({
  row,
}: {
  row: Pick<HubCaseRow, 'missingSince' | 'testId' | 'changedSinceImport'>;
}) {
  const { t } = useTranslation();
  if (row.missingSince) {
    return <Badge variant="destructive">{t('testCaseHub.state.missing', 'Missing')}</Badge>;
  }
  if (row.testId && row.changedSinceImport) {
    return (
      <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
        {t('testCaseHub.state.changed', 'Changed since import')}
      </Badge>
    );
  }
  if (row.testId) {
    return <Badge>{t('testCaseHub.state.imported', 'Imported')}</Badge>;
  }
  return <Badge variant="secondary">{t('testCaseHub.state.notImported', 'Not imported')}</Badge>;
}
