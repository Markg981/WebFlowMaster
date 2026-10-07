import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { readMatrixEvidence } from '@shared/matrix-evidence';

export default function MatrixEvidenceCard({
  rows,
}: {
  rows: { id: string; testName: string; detailedLog: string | null }[];
}) {
  const { t } = useTranslation();
  const entries = rows.flatMap((row) =>
    readMatrixEvidence(row.detailedLog).map((evidence, i) => ({ row, evidence, i })),
  );
  if (!entries.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('matrixEvidence.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{t('matrixEvidence.description')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['test', 'route', 'requested', 'effective', 'verdict'].map((key) => (
                  <th key={key} className="p-2 text-left">
                    {t(`matrixEvidence.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(({ row, evidence: e, i }) => (
                <tr key={`${row.id}-${i}`}>
                  <td className="p-2">{row.testName}</td>
                  <td className="p-2">
                    {e.route}
                    {e.provider && ` / ${e.provider}`}
                  </td>
                  <td className="p-2">
                    <pre>{JSON.stringify(e.requested, null, 2)}</pre>
                  </td>
                  <td className="p-2">
                    <pre>{JSON.stringify(e.effective, null, 2)}</pre>
                  </td>
                  <td className="p-2">
                    <strong>{t(`matrixEvidence.${e.verdict}`)}</strong>
                    <ul>
                      {e.differences.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                    <small>
                      {e.source} · {e.observedAt}
                      {e.sessionId && ` · ${e.sessionId}`}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
