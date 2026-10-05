import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ManualStep } from '@shared/manual-tests';
export default function GherkinArguments({ argument }: { argument?: ManualStep['gherkin'] }) {
  const { t } = useTranslation();
  if (!argument) return null;
  return (
    <div className="col-span-full space-y-2 min-w-0" data-testid="gherkin-arguments">
      {argument.docString && (
        <div>
          <p className="text-xs text-muted-foreground">
            {t('bdd.docString', 'Doc string')}
            {argument.docString.mediaType && ` · ${argument.docString.mediaType}`}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
            {argument.docString.content}
          </pre>
        </div>
      )}
      {argument.dataTable && (
        <div className="overflow-x-auto">
          <table className="text-xs" aria-label={t('bdd.dataTable', 'Step data table')}>
            <tbody>
              {argument.dataTable.rows.map((row, i) => (
                <tr key={i}>
                  {row.cells.map((cell, j) => (
                    <td className="border p-2 whitespace-pre-wrap" key={j}>
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
