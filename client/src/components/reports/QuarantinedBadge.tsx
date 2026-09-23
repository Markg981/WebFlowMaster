import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert } from 'lucide-react';

/** On a result whose test was in quarantine when it ran: its failure did not count against the run. */
export default function QuarantinedBadge({ quarantined }: { quarantined?: boolean | null }) {
  const { t } = useTranslation();
  if (!quarantined) return null;
  return (
    <Badge
      variant="outline"
      className="ml-2 font-normal whitespace-nowrap"
      title={t('quarantine.badgeTitle', 'This test was in quarantine: a failure of it does not fail the run.')}
      data-testid="quarantined-badge"
    >
      <ShieldAlert className="mr-1 h-3 w-3" />
      {t('quarantine.badge', 'quarantined')}
    </Badge>
  );
}
