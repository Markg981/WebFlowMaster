import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { MobileGroupDefinition } from '@shared/mobile-groups';
import MobileGroupDialog from './MobileGroupDialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function MobileGroupsPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [editing, setEditing] = useState<MobileGroupDefinition | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MobileGroupDefinition | null>(null);
  const [error, setError] = useState('');
  const { data: groups = [], error: loadError } = useQuery<MobileGroupDefinition[]>({
    queryKey: ['mobileStepGroups'],
    queryFn: async () => {
      const res = await fetch('/api/mobile-step-groups');
      if (!res.ok)
        throw new Error(t('mobileTests.flow.loadFailed', 'Could not load mobile groups.'));
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
  });
  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/mobile-step-groups/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      await cache.invalidateQueries({ queryKey: ['mobileStepGroups'] });
      setDeleting(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="rounded border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t('mobileTests.flow.groups', 'Reusable mobile groups')}</h2>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing('new')}>
            {t('mobileTests.flow.newGroup', 'New group')}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'mobileTests.flow.groupHint',
          'Reuse native steps in tests on the same platform. Queued runs retain their original group content.',
        )}
      </p>
      {groups.map((group) => (
        <div className="flex gap-2 items-center" key={group.id}>
          <span className="flex-1 text-sm">
            {group.name} · {group.platform}
          </span>
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>
                {t('mobileTests.edit', 'Edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setError('');
                  setDeleting(group);
                }}
              >
                {t('mobileTests.delete', 'Delete')}
              </Button>
            </>
          )}
        </div>
      ))}
      {(error || loadError) && (
        <p role="alert" className="text-destructive">
          {error || loadError?.message}
        </p>
      )}
      <MobileGroupDialog
        group={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void cache.invalidateQueries({ queryKey: ['mobileStepGroups'] });
        }}
      />
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('mobileTests.flow.deleteGroup', 'Delete mobile group?')}
            </AlertDialogTitle>
            <AlertDialogDescription>{deleting?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('mobileTests.close', 'Close')}</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>
              {t('mobileTests.delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
