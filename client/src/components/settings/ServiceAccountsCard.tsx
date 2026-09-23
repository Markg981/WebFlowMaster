import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Loader2, Trash2 } from 'lucide-react';
import type { ServiceAccountSummary } from './ApiKeysCard';

/**
 * Accounts that are not people, for the keys a pipeline keeps.
 *
 * A key issued to a person stops working the day they leave, or keeps their access alive so it
 * will not. A service account has a name and a role, cannot sign in, and holds keys; disabling
 * it revokes them all. Owners only — the server enforces it; this card is simply not shown to
 * anyone else.
 */
const ServiceAccountsCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [formError, setFormError] = useState('');

  const { data: accounts = [], isLoading, error } = useQuery<ServiceAccountSummary[]>({
    queryKey: ['serviceAccounts'],
    queryFn: async () => {
      const response = await fetch('/api/service-accounts');
      if (!response.ok) throw new Error('Could not load the service accounts');
      return response.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/service-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), role }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create the service account');
      }
      return response.json();
    },
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['serviceAccounts'] });
    },
    onError: (mutationError: Error) => setFormError(mutationError.message),
  });

  const disable = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/service-accounts/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not disable the service account');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceAccounts'] });
      // Its keys were revoked with it.
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  const handleCreate = () => {
    if (name.trim() === '') {
      setFormError(t('settings.serviceAccounts.nameRequired', 'Give the account a name, such as the pipeline it is for.'));
      return;
    }
    setFormError('');
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.serviceAccounts.title', 'Service accounts')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.serviceAccounts.description',
            'Accounts for pipelines rather than people. They cannot sign in, and their keys keep working when somebody leaves. Disabling one revokes all its keys.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Label htmlFor="serviceAccountName">{t('settings.serviceAccounts.nameLabel', 'Name')}</Label>
            <Input
              id="serviceAccountName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GitHub Actions"
              className="mt-1"
            />
          </div>
          <div className="w-full sm:w-40">
            <Label>{t('settings.serviceAccounts.roleLabel', 'Role')}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as 'viewer' | 'editor')}>
              <SelectTrigger className="mt-1" aria-label={t('settings.serviceAccounts.roleLabel', 'Role')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">{t('settings.serviceAccounts.roles.viewer', 'viewer')}</SelectItem>
                <SelectItem value="editor">{t('settings.serviceAccounts.roles.editor', 'editor')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('settings.serviceAccounts.create', 'Create account')}
          </Button>
        </div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.serviceAccounts.loading', 'Loading accounts…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.serviceAccounts.empty', 'No service accounts yet. Create one, then issue it a key above.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between p-2 border rounded-md" data-testid={`service-account-${account.id}`}>
                <span className="text-sm">
                  <span className="font-medium">{account.name}</span>
                  <Badge variant="outline" className="ml-2">
                    {t(`settings.serviceAccounts.roles.${account.role}`, account.role)}
                  </Badge>
                  {account.disabledAt && (
                    <Badge variant="secondary" className="ml-2">
                      {t('settings.serviceAccounts.disabled', 'disabled')}
                    </Badge>
                  )}
                </span>
                {!account.disabledAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disable.mutate(account.id)}
                    disabled={disable.isPending}
                    aria-label={t('settings.serviceAccounts.disableAction', 'Disable {{name}}', { name: account.name })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default ServiceAccountsCard;
