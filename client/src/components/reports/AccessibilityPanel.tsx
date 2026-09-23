import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Accessibility, ExternalLink } from 'lucide-react';
import type { AccessibilityFinding, AccessibilityImpact } from '@shared/accessibility';

/**
 * What an accessibility check found on a step's page.
 *
 * Every violation is listed, the ones that failed the step first and marked as such, so the minor
 * ones are visible without being what the verdict is about. Each links to axe's page on the rule,
 * which says what it means and how to fix it better than a sentence here could.
 */

const IMPACT_VARIANT: Record<AccessibilityImpact, 'destructive' | 'secondary' | 'outline'> = {
  critical: 'destructive',
  serious: 'destructive',
  moderate: 'secondary',
  minor: 'outline',
};

export default function AccessibilityPanel({ finding }: { finding: AccessibilityFinding }) {
  const { t } = useTranslation();
  const failedStep = finding.blocking > 0;
  return (
    <div className={`mt-3 rounded-md border p-3 ${failedStep ? 'border-destructive/60' : 'dark:border-slate-700'}`} data-testid="accessibility-panel">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Accessibility className="h-4 w-4" />
        <span className="text-sm font-medium">{t('accessibility.title', 'Accessibility check')}</span>
        <span className="text-xs text-muted-foreground">
          {t('accessibility.summary', '{{violations}} rules broken, {{passes}} passed, {{incomplete}} need a person to check · fails at {{threshold}} or worse', {
            violations: finding.violations.length,
            passes: finding.passes,
            incomplete: finding.incomplete,
            threshold: t(`accessibility.impact.${finding.threshold}`, finding.threshold),
          })}
        </span>
      </div>
      {finding.violations.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('accessibility.clean', 'No rule was broken on this page.')}</p>
      ) : (
        <ul className="space-y-2">
          {finding.violations.map((violation) => (
            <li key={violation.id} className="text-xs" data-testid={`violation-${violation.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {violation.impact && (
                  <Badge variant={IMPACT_VARIANT[violation.impact]} className="whitespace-nowrap">
                    {t(`accessibility.impact.${violation.impact}`, violation.impact)}
                  </Badge>
                )}
                <a href={violation.helpUrl} target="_blank" rel="noreferrer" className="font-medium underline inline-flex items-center gap-1">
                  {violation.id}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
                <span>{violation.help}</span>
                <span className="text-muted-foreground">
                  {t('accessibility.elements', '{{count}} element(s)', { count: violation.count })}
                </span>
                {violation.blocking && (
                  <span className="text-destructive font-medium">{t('accessibility.failedStep', 'failed the step')}</span>
                )}
              </div>
              {violation.targets.length > 0 && (
                <div className="mt-1 pl-2 text-muted-foreground font-mono break-all">
                  {violation.targets.join(' · ')}
                  {violation.count > violation.targets.length && ` · +${violation.count - violation.targets.length}`}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
