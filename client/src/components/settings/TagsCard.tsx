import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { apiRequest, ApiError, errorMessage } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { TAGS_QUERY_KEY, useTags, type TagSummary } from '@/hooks/use-tags';

/**
 * The organization's tags, looked after in one place.
 *
 * A tag is added from a test's row, which is the right place to add one and the wrong place
 * to maintain the set: from there nobody sees that "smoke" and "Smoke" both exist, or that
 * "nigthly" is on one test and "nightly" on forty. This card lists every tag with how many
 * tests carry it, renames one (every test follows), and deletes one (it comes off every test).
 */

/**
 * What the server said, for a toast: errorMessage() already puts the field error behind a 400
 * first ("name: at most 60 characters"), so it is not appended a second time here.
 */
function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return errorMessage(error) || fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

const totalOf = (tag: TagSummary) => tag.uiCount + tag.apiCount + tag.mobileCount;

const TagsCard: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tags = [], isLoading, error: loadError } = useTags();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<TagSummary | null>(null);

  const rename = useMutation({
    mutationFn: async (input: { id: string; from: string; name: string }) => {
      const res = await apiRequest('PUT', `/api/tags/${input.id}`, { name: input.name });
      return (await res.json()) as { id: string; name: string };
    },
    onSuccess: (updated, input) => {
      setEditing(null);
      toast({
        title: t('settings.tags.renamed.title', 'Tag renamed'),
        description: t(
          'settings.tags.renamed.description',
          'Every test that carried “{{from}}” now shows “{{to}}”.',
          { from: input.from, to: updated.name },
        ),
      });
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
    },
    onError: (error: unknown) =>
      toast({
        title: t('common.error', 'Error'),
        description: serverMessage(
          error,
          t('settings.tags.renameFailed', 'Could not rename the tag.'),
        ),
        variant: 'destructive',
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/tags/${id}`);
      return (await res.json()) as { removedFrom: number };
    },
    onSuccess: (result) => {
      toast({
        title: t('settings.tags.deleted.title', 'Tag deleted'),
        description: t('settings.tags.deleted.description', 'Removed from {{count}} tests.', {
          count: result.removedFrom,
        }),
      });
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
    },
    onError: (error: unknown) =>
      toast({
        title: t('common.error', 'Error'),
        description: serverMessage(
          error,
          t('settings.tags.deleteFailed', 'Could not delete the tag.'),
        ),
        variant: 'destructive',
      }),
    onSettled: () => setRemoving(null),
  });

  const submitRename = (tag: TagSummary) => {
    if (!editing) return;
    const name = editing.name.trim();
    if (name === '') {
      toast({
        title: t('common.error', 'Error'),
        description: t('settings.tags.nameRequired', 'A tag needs a name.'),
        variant: 'destructive',
      });
      return;
    }
    if (name === tag.name) {
      setEditing(null);
      return;
    }
    rename.mutate({ id: tag.id, from: tag.name, name });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TagIcon className="h-5 w-5" aria-hidden />
          {t('settings.tags.title', 'Tags')}
        </CardTitle>
        <CardDescription>
          {t(
            'settings.tags.description',
            'Every tag the organization uses, with how many tests carry it. A rename reaches every test at once; a tag on no test is a typo or a leftover.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {t('settings.tags.loadFailed', 'Could not load the tags.')}
          </p>
        )}

        {isLoading ? (
          <Loader2
            className="h-4 w-4 animate-spin"
            aria-label={t('settings.tags.loading', 'Loading tags…')}
          />
        ) : tags.length === 0 ? (
          !loadError && (
            <p className="text-sm text-muted-foreground">
              {t('settings.tags.empty', 'No tags yet. The first one is added from a test’s row.')}
            </p>
          )
        ) : (
          <ul className="divide-y rounded-md border">
            {tags.map((tag) => {
              const isEditing = editing?.id === tag.id;
              return (
                <li key={tag.id} className="flex items-center justify-between gap-3 p-3">
                  {isEditing ? (
                    <form
                      className="flex min-w-0 flex-1 items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename(tag);
                      }}
                    >
                      <Input
                        aria-label={t('settings.tags.nameLabel', 'New name')}
                        value={editing.name}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                      />
                      <Button type="submit" size="sm" disabled={rename.isPending}>
                        {rename.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('common.save', 'Save')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={rename.isPending}
                        onClick={() => setEditing(null)}
                      >
                        <X className="mr-1 h-4 w-4" />
                        {t('common.cancel', 'Cancel')}
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Badge variant="secondary" className="truncate">
                          {tag.name}
                        </Badge>
                        <span
                          className="text-sm text-muted-foreground"
                          title={t(
                            'settings.tags.breakdown',
                            '{{ui}} web, {{api}} API, {{mobile}} mobile',
                            {
                              ui: tag.uiCount,
                              api: tag.apiCount,
                              mobile: tag.mobileCount,
                            },
                          )}
                        >
                          {t('settings.tags.usage', '{{count}} tests', { count: totalOf(tag) })}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('settings.tags.rename', 'Rename')}
                          onClick={() => setEditing({ id: tag.id, name: tag.name })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('settings.tags.delete', 'Delete')}
                          disabled={remove.isPending}
                          onClick={() => setRemoving(tag)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
        title={t('settings.tags.deleteDialog.title', 'Delete tag “{{name}}”?', {
          name: removing?.name ?? '',
        })}
        description={t(
          'settings.tags.deleteDialog.description',
          'It is removed from the {{count}} tests that carry it, and a dynamic suite that selects by it no longer matches them. This cannot be undone.',
          { count: removing ? totalOf(removing) : 0 },
        )}
        confirmLabel={t('common.delete', 'Delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
};

export default TagsCard;
