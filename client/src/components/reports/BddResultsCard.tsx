import React from 'react';
import { useTranslation } from 'react-i18next';
import { BddAgentResultSchema, type BddAgentResult } from '@shared/bdd-agent';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
interface Row {
  id: string;
  testName: string;
  detailedLog: string | null;
}
function runsOf(log: string | null): BddAgentResult[] {
  if (!log || log.length > 16 * 1024 * 1024) return [];
  try {
    const raw = JSON.parse(log)?.bdd?.runs;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 100).flatMap((run) => {
      const safe = {
        ...run,
        attachments: Array.isArray(run?.attachments)
          ? run.attachments.filter((a: any) => a?.mediaType === 'text/plain')
          : undefined,
      };
      const result = BddAgentResultSchema.safeParse(safe);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}
export default function BddResultsCard({ rows }: { rows: Row[] }) {
  const { t } = useTranslation();
  const entries = rows
    .map((row) => ({ row, runs: runsOf(row.detailedLog) }))
    .filter((entry) => entry.runs.length);
  if (!entries.length) return null;
  return (
    <Card data-testid="bdd-results">
      <CardHeader>
        <CardTitle>{t('bdd.results', 'Cucumber evidence')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.map(({ row, runs }) => (
          <section key={row.id}>
            <h3 className="font-medium">{row.testName}</h3>
            {runs.map((run, i) => (
              <details key={i} open className="border rounded p-3 mt-2" data-testid="bdd-run">
                <summary>
                  {t('bdd.attempt', 'Attempt')} {i + 1} · {run.status} · {run.durationMs} ms
                </summary>
                {run.error && (
                  <pre className="whitespace-pre-wrap wrap-break-word text-xs text-destructive">
                    {run.error}
                  </pre>
                )}
                <ol className="space-y-2 mt-2">
                  {run.steps.map((step, j) => (
                    <li key={j} className="border rounded p-2 text-sm">
                      <span>{step.name}</span>{' '}
                      <Badge variant={step.status === 'PASSED' ? 'secondary' : 'destructive'}>
                        {step.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        · {step.kind === 'hook'
                          ? t('bdd.hook', 'Hook')
                          : t('bdd.step', 'Step')} · {step.durationMs} ms
                      </span>
                      {step.error && (
                        <pre className="whitespace-pre-wrap wrap-break-word text-xs text-destructive">
                          {step.error}
                        </pre>
                      )}
                      {step.status === 'UNDEFINED' && (
                        <p className="text-xs">
                          {t(
                            'bdd.undefinedHelp',
                            'Ask the support project operator to implement a matching step definition.',
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                {run.attachments?.map((attachment, j) => (
                  <details key={j} className="mt-2">
                    <summary>
                      {t('bdd.attachment', 'Text attachment')} {j + 1}
                    </summary>
                    <pre
                      className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word text-xs"
                      data-testid="bdd-attachment"
                    >
                      {attachment.text}
                    </pre>
                  </details>
                ))}
              </details>
            ))}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
