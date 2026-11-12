import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The parity report as a file: the record of a comparison to attach to a migration's sign-off.
 * Same shape as the run's export menu (ExportRunMenu).
 */

const FORMATS = [
  {
    key: 'html',
    label: 'HTML parity report',
    hint: 'One file that opens anywhere: verdicts, tolerances and reviews',
  },
  { key: 'pdf', label: 'PDF', hint: 'To attach to a sign-off or file for an audit' },
] as const;

export default function ExportComparisonMenu({ comparisonId }: { comparisonId: string }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" /> {t('comparisons.export.button', 'Export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          {t('comparisons.export.title', 'Download the parity report as')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map((format) => (
          <DropdownMenuItem key={format.key} asChild>
            <a
              href={`/api/comparisons/${encodeURIComponent(comparisonId)}/export/${format.key}`}
              download
              data-testid={`export-comparison-${format.key}`}
            >
              <div className="flex flex-col">
                <span>{t(`comparisons.export.formats.${format.key}.label`, format.label)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`comparisons.export.formats.${format.key}.hint`, format.hint)}
                </span>
              </div>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
