import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CommentKind } from '@shared/comments';

interface Comment { id: number; authorId: number | null; authorName: string | null; body: string; createdAt: string; updatedAt: string }
export default function CommentsPanel({ kind, targetId }: { kind: CommentKind; targetId: string | number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputId = useId();
  const url = `/api/comments/${kind}/${encodeURIComponent(targetId)}`;
  const queryKey = ['comments', user?.organizationId, user?.id, kind, targetId];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const { data, isLoading, error } = useQuery<Comment[]>({ queryKey, enabled: !!user, queryFn: async () => {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(t('comments.loadFailed', 'Could not load comments'));
    return response.json();
  } });
  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', id?: number) {
    setBusy(true); setFailure('');
    try {
      const response = await fetch(id === undefined ? url : `/api/comments/${id}`, {
        method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify({ body: (method === 'POST' ? draft : editedBody).trim() }) }),
      });
      if (!response.ok) throw new Error(t('comments.saveFailed', 'Could not save the comment'));
      if (method === 'POST') setDraft('');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) { setFailure((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section aria-label={t('comments.title', 'Comments')} className="space-y-4">
    <h3 className="font-semibold">{t('comments.title', 'Comments')}</h3>
    {isLoading && <p role="status">{t('comments.loading', 'Loading comments…')}</p>}
    {(error || failure) && <p role="alert" className="text-destructive">{failure || (error as Error).message}</p>}
    {data?.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty', 'No comments yet.')}</p>}
    <ul className="space-y-3">{data?.map(comment => <li key={comment.id} className="rounded border p-3 space-y-2">
      <p className="text-sm"><strong>{comment.authorName || t('comments.formerMember', 'Former member')}</strong>{' '}<time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time></p>
      {editing === comment.id ? <>
        <label htmlFor={`${inputId}-${comment.id}`}>{t('comments.edit', 'Edit comment')}</label>
        <Textarea id={`${inputId}-${comment.id}`} maxLength={5000} value={editedBody} onChange={event => setEditedBody(event.target.value)} />
        <Button disabled={busy || !editedBody.trim()} onClick={() => void mutate('PATCH', comment.id)}>{t('comments.save', 'Save comment')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t('comments.cancel', 'Cancel')}</Button>
      </> : <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>}
      {(user?.id === comment.authorId || user?.role === 'owner') && editing !== comment.id && <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(comment.id); setEditedBody(comment.body); }}>{t('comments.edit', 'Edit comment')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate('DELETE', comment.id)}>{t('comments.delete', 'Delete comment')}</Button>
      </div>}
    </li>)}</ul>
    {user && <form onSubmit={event => { event.preventDefault(); if (draft.trim()) void mutate('POST'); }} className="space-y-2">
      <label htmlFor={inputId}>{t('comments.new', 'New comment')}</label>
      <Textarea id={inputId} maxLength={5000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
      <Button type="submit" disabled={busy || !draft.trim()}>{t('comments.add', 'Add comment')}</Button>
    </form>}
  </section>;
}
