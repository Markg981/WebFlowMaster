import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Loader2, Trash2 } from 'lucide-react';

/**
 * The organization's data, taken away or erased (owners only): the screen over
 * GET /api/organization/export and DELETE /api/organization, which used to be API-only.
 *
 * Erasure asks for the organization's name, as the API does: it cannot be undone, and it takes
 * every member account with it.
 */

export default function ExportEraseCard({ onErased }: { onErased?: () => void }) {
  const { t } = useTranslation();
  const { data } = useQuery<{ organization: { name: string } }>({
    queryKey: ['organization'],
    queryFn: async () => {
      const res = await fetch('/api/organization', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load the organization');
      return res.json();
    },
  });
  const organizationName = data?.organization?.name ?? '';
  const [exporting, setExporting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/organization/export', { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `organization-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const erase = async () => {
    if (!window.confirm(t('organizationData.lastWarning', 'Erase {{name}} and every account in it? This cannot be undone.', { name: organizationName }))) return;
    setErasing(true);
    setError(null);
    try {
      const res = await fetch('/api/organization', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erasure failed (${res.status})`);
      if (onErased) onErased();
      else window.location.assign('/auth');
    } catch (e) {
      setError((e as Error).message);
      setErasing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" /> {t('organizationData.exportTitle', 'Export everything')}
          </CardTitle>
          <CardDescription>
            {t(
              'organizationData.exportDescription',
              'One JSON file with every table of the organization: members, projects, tests, plans, runs and the audit log. Passwords and tokens are left out; secrets stay encrypted. Treat the file as confidential.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={download} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t('organizationData.download', 'Download the export')}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" /> {t('organizationData.eraseTitle', 'Erase the organization')}
          </CardTitle>
          <CardDescription>
            {t(
              'organizationData.eraseDescription',
              'Deletes the organization, every member account, all its data and its files (run evidence and visual baselines). It cannot be undone: download an export first if you may need anything.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="erase-confirm">{t('organizationData.typeName', 'Type the organization name, {{name}}, to confirm', { name: organizationName })}</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="erase-confirm" className="max-w-xs" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
            <Button variant="destructive" onClick={erase} disabled={erasing || !organizationName || confirmName !== organizationName}>
              {erasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('organizationData.erase', 'Erase permanently')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
