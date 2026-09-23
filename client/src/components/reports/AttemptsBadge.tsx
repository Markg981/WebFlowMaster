import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

/**
 * How many times a test ran before its result stood, when that was more than once.
 *
 * A test that passed on its second attempt is a pass and a finding: it is flaky, and a report
 * that shows it exactly like a first-time pass hides the one thing worth fixing before it starts
 * failing for real. Nothing is shown for a test that ran once, which is almost every test.
 */
export default function AttemptsBadge({ attempts, status }: { attempts?: number | null; status: string }) {
  const { t } = useTranslation();
  if (!attempts || attempts <= 1) return null;

  if (status.toLowerCase() === 'passed') {
    return (
      <Badge
        variant="outline"
        className="ml-2 font-normal border-amber-500 text-amber-700 dark:text-amber-400"
        title={t('testReportPage.flaky.title', 'Passed only after being run again: this test is flaky.')}
      >
        {t('testReportPage.flaky.label', 'Flaky · passed on attempt {{attempts}}', { attempts })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="ml-2 font-normal" title={t('testReportPage.attempts.title', 'Run again after failing; this is the last attempt.')}>
      {t('testReportPage.attempts.label', '{{attempts}} attempts', { attempts })}
    </Badge>
  );
}
