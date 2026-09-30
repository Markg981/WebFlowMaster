import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { normaliseCaseKey, type TestManagementProvider } from '@shared/test-management';

/**
 * Which case in the tool each test is, for one connection: a key per test, typed in the row.
 * A test whose name already carries a key ("[C123] Login") shows it as the placeholder and is
 * published under it without anything typed here.
 */

interface CaseRow {
  type: 'ui' | 'api' | 'mobile';
  id: number;
  name: string;
  caseKey: string | null;
  fromName: string | null;
}

interface Props {
  connection: { id: string; name: string } | null;
  onClose: () => void;
}

const rowKey = (row: { type: string; id: number }) => `${row.type}:${row.id}`;
const EXAMPLE: Record<TestManagementProvider, string> = { testrail: 'C123', xray_cloud: 'SHOP-45', xray_server: 'SHOP-45', zephyr_scale: 'SHOP-T12' };

export default function TestCasesDialog({ connection, onClose }: Props) {
  const { t } = useTranslation();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading, refetch } = useQuery<{ provider: TestManagementProvider; tests: CaseRow[] }>({
    queryKey: ['testManagementCases', connection?.id],
    queryFn: async () => {
      const response = await fetch(`/api/test-management/${connection!.id}/cases`);
      if (!response.ok) throw new Error(t('testManagement.cases.loadFailed', 'Could not load the tests.'));
      return response.json();
    },
    enabled: !!connection,
  });

  useEffect(() => {
    setEdits({});
    setFilter('');
    setError('');
  }, [connection]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = data?.tests ?? [];
    return needle ? all.filter((row) => row.name.toLowerCase().includes(needle) || (row.caseKey ?? '').toLowerCase().includes(needle)) : all;
  }, [data, filter]);

  const provider = data?.provider;
  const changed = Object.entries(edits).filter(([key, value]) => {
    const row = data?.tests.find((r) => rowKey(r) === key);
    return (row?.caseKey ?? '') !== value.trim();
  });
  const invalid = provider ? changed.filter(([, value]) => value.trim() !== '' && !normaliseCaseKey(provider, value)) : [];

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/test-management/${connection!.id}/cases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: changed.map(([key, value]) => {
            const [type, id] = key.split(':');
            return { type, id: Number(id), caseKey: value.trim() || null };
          }),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('testManagement.cases.saveFailed', 'The cases were not saved.'));
      setEdits({});
      await refetch();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={connection !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('testManagement.cases.title', 'Test cases in {{name}}', { name: connection?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t(
              'testManagement.cases.description',
              'The case each test is published as. A key in the test’s name, like [{{example}}] Login, is used when nothing is typed here. Tests with neither are not published.',
              { example: provider ? EXAMPLE[provider] : 'C123' },
            )}
          </DialogDescription>
        </DialogHeader>
        <Input placeholder={t('testManagement.cases.filter', 'Filter tests or keys…')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('testManagement.cases.filter', 'Filter tests or keys…')} />
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('testManagement.loading', 'Loading…')}</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded border divide-y" data-testid="test-case-rows">
            {rows.map((row) => {
              const key = rowKey(row);
              const value = edits[key] ?? row.caseKey ?? '';
              const bad = provider && value.trim() !== '' && !normaliseCaseKey(provider, value);
              return (
                <div key={key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <Badge variant="outline" className="shrink-0">{row.type === 'ui' ? t('testManagement.web', 'Web') : row.type === 'mobile' ? t('testManagement.mobile', 'Mobile') : 'API'}</Badge>
                  <span className="flex-1 truncate" title={row.name}>{row.name}</span>
                  <Input
                    className={`w-36 font-mono text-xs ${bad ? 'border-destructive' : ''}`}
                    value={value}
                    placeholder={row.fromName ?? '—'}
                    aria-label={t('testManagement.cases.keyFor', 'Case of {{name}}', { name: row.name })}
                    aria-invalid={!!bad}
                    onChange={(e) => setEdits((current) => ({ ...current, [key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        )}
        {invalid.length > 0 && provider && (
          <p className="text-sm text-destructive" role="alert">
            {t('testManagement.cases.invalid', 'Not a case key of this tool (like {{example}}): {{keys}}', { example: EXAMPLE[provider], keys: invalid.map(([, v]) => v).join(', ') })}
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('testManagement.cancel', 'Cancel')}</Button>
          <Button onClick={save} disabled={saving || changed.length === 0 || invalid.length > 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('testManagement.cases.save', 'Save {{count}} changes', { count: changed.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
