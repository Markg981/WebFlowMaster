import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, KeySquare, Loader2, Trash2 } from 'lucide-react';

/**
 * The credentials a pipeline authenticates with.
 *
 * Everything here was behind a session cookie, so the only way to run a plan from CI was to
 * put somebody's password in the pipeline. A key belongs to the organization, carries the
 * role of whoever made it, and can be revoked without touching that person's account.
 */

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

async function fetchApiKeys(): Promise<ApiKeySummary[]> {
  const response = await fetch('/api/api-keys');
  if (!response.ok) throw new Error('Could not load the API keys');
  return response.json();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const ApiKeysCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [formError, setFormError] = useState('');
  /** Shown once, because the server cannot produce it a second time. */
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys = [], isLoading, error } = useQuery<ApiKeySummary[]>({
    queryKey: ['apiKeys'],
    queryFn: fetchApiKeys,
  });

  const createKey = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(expiresInDays.trim() ? { expiresInDays: Number(expiresInDays) } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create the API key');
      }
      return response.json() as Promise<ApiKeySummary & { key: string }>;
    },
    onSuccess: (created) => {
      setFreshKey(created.key);
      setName('');
      setExpiresInDays('');
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not revoke the API key');
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apiKeys'] }),
  });

  const handleCreate = () => {
    if (name.trim() === '') {
      setFormError(t('settings.apiKeys.nameRequired', 'Give the key a name, so it can be recognised later.'));
      return;
    }
    if (expiresInDays.trim() !== '' && (!Number.isInteger(Number(expiresInDays)) || Number(expiresInDays) < 1)) {
      setFormError(t('settings.apiKeys.expiryInvalid', 'Expiry must be a whole number of days.'));
      return;
    }
    setFormError('');
    createKey.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <KeySquare className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.apiKeys.title', 'API keys')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.apiKeys.description',
            'For pipelines and scripts. A key acts as you, with your role, and can be revoked on its own.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {freshKey && (
          <Alert>
            <AlertTitle>{t('settings.apiKeys.shownOnce.title', 'Copy this key now')}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-xs">
                {t(
                  'settings.apiKeys.shownOnce.body',
                  'This is the only time it is shown. The server keeps a hash, so it cannot show it again.',
                )}
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all bg-muted px-2 py-1 rounded flex-1" data-testid="fresh-api-key">
                  {freshKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(freshKey).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    );
                  }}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  {copied ? t('settings.apiKeys.copied', 'Copied') : t('settings.apiKeys.copy', 'Copy')}
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setFreshKey(null)}>
                {t('settings.apiKeys.dismiss', 'I have saved it')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Label htmlFor="apiKeyName">{t('settings.apiKeys.nameLabel', 'Name')}</Label>
            <Input
              id="apiKeyName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GitHub Actions"
              className="mt-1"
            />
          </div>
          <div className="w-full sm:w-40">
            <Label htmlFor="apiKeyExpiry">{t('settings.apiKeys.expiryLabel', 'Expires in (days)')}</Label>
            <Input
              id="apiKeyExpiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder={t('settings.apiKeys.expiryPlaceholder', 'never')}
              className="mt-1"
            />
          </div>
          <Button onClick={handleCreate} disabled={createKey.isPending}>
            {createKey.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('settings.apiKeys.create', 'Create key')}
          </Button>
        </div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.apiKeys.loading', 'Loading keys…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.apiKeys.empty', 'No API keys yet. A pipeline needs one to start a test plan.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.apiKeys.columns.name', 'Name')}</TableHead>
                  <TableHead>{t('settings.apiKeys.columns.key', 'Key')}</TableHead>
                  <TableHead>{t('settings.apiKeys.columns.lastUsed', 'Last used')}</TableHead>
                  <TableHead>{t('settings.apiKeys.columns.expires', 'Expires')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      {key.name}
                      {key.revokedAt && (
                        <Badge variant="secondary" className="ml-2">
                          {t('settings.apiKeys.revoked', 'revoked')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{key.prefix}…</code>
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(key.lastUsedAt)}</TableCell>
                    <TableCell className="text-xs">{formatDate(key.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      {!key.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeKey.mutate(key.id)}
                          disabled={revokeKey.isPending}
                          aria-label={t('settings.apiKeys.revokeAction', 'Revoke key')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ApiKeysCard;
