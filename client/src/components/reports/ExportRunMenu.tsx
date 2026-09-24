import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download } from 'lucide-react';

/**
 * The run as a file to hand on. Replaces three buttons (PDF, CSV, Share) that only wrote to the
 * console: a button that does nothing is worse than none, since somebody clicks it before a
 * release meeting.
 */

const FORMATS = [
  { key: 'html', path: 'export/html', label: 'HTML report', hint: 'One file that opens anywhere, screenshots included' },
  { key: 'pdf', path: 'export/pdf', label: 'PDF', hint: 'To attach to a ticket or file for an audit' },
  { key: 'allure', path: 'export/allure', label: 'Allure results (.zip)', hint: 'For allure generate or an Allure server' },
  { key: 'junit', path: 'junit', label: 'JUnit XML', hint: 'For a CI system’s test report' },
] as const;

export default function ExportRunMenu({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" /> {t('exportRun.button', 'Export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('exportRun.title', 'Download this run as')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map((format) => (
          <DropdownMenuItem key={format.key} asChild>
            <a href={`/api/test-plan-executions/${encodeURIComponent(executionId)}/${format.path}`} download data-testid={`export-${format.key}`}>
              <div className="flex flex-col">
                <span>{t(`exportRun.formats.${format.key}.label`, format.label)}</span>
                <span className="text-xs text-muted-foreground">{t(`exportRun.formats.${format.key}.hint`, format.hint)}</span>
              </div>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
