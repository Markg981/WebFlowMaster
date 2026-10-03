import React, { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CommentKind } from '@shared/comments';

interface Comment { id: number; authorId: number | null; authorName: string | null; body: string; createdAt: string; updatedAt: string; parentId?: number | null; mentionedUserIds?: number[]; resolvedAt?: string | null; deletedAt?: string | null }
interface Member { id: number; username: string }
export default function CommentsPanel({ kind, targetId }: { kind: CommentKind; targetId: string | number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputId = useId();
  const url = `/api/comments/${kind}/${encodeURIComponent(targetId)}`;
  const [filter, setFilter] = useState('all');
  const queryKey = ['comments', user?.organizationId, user?.id, kind, targetId];
  const [draft, setDraft] = useState('');
  const [draftMentions, setDraftMentions] = useState<number[]>([]);
  const [replying, setReplying] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyMentions, setReplyMentions] = useState<number[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [editedMentions, setEditedMentions] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    setDraft(''); setDraftMentions([]); setReplying(null); setReplyBody(''); setReplyMentions([]); setEditing(null); setFailure('');
  }, [user?.id, user?.organizationId, kind, targetId]);
  const { data, isLoading, error } = useQuery<Comment[]>({ queryKey: [...queryKey, filter], enabled: !!user, queryFn: async () => {
    const response = await fetch(filter === 'all' ? url : `${url}?filter=${filter}`, { credentials: 'include' });
    if (!response.ok) throw new Error(t('comments.loadFailed', 'Could not load comments'));
    return response.json();
  } });
  const { data: members = [], error: memberError } = useQuery<Member[]>({ queryKey: [...queryKey, 'members'], enabled: !!user, queryFn: async () => {
    const response = await fetch(`${url}/members`, { credentials: 'include' });
    if (!response.ok) throw new Error(t('comments.membersFailed', 'Could not load mention recipients'));
    return response.json();
  } });
  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: object, after?: () => void) {
    setBusy(true); setFailure('');
    try {
      const response = await fetch(path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error(t('comments.saveFailed', 'Could not save the comment'));
      after?.();
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) { setFailure((err as Error).message); }
    finally { setBusy(false); }
  }
  function mentionPicker(selected: number[], change: (ids: number[]) => void) {
    return <details><summary className="cursor-pointer text-sm">{t('comments.mentionMembers', 'Mention members')}</summary>
      {memberError ? <p role="alert">{(memberError as Error).message}</p> : <fieldset className="flex flex-wrap gap-3 py-2"><legend className="sr-only">{t('comments.mentionMembers', 'Mention members')}</legend>
        {members.map(member => <label key={member.id} className="flex items-center gap-1 text-sm"><input type="checkbox" aria-label={`${t('comments.mention', 'Mention')} ${member.username}`} checked={selected.includes(member.id)} disabled={busy || (!selected.includes(member.id) && selected.length >= 20)} onChange={event => change(event.target.checked ? [...selected, member.id] : selected.filter(id => id !== member.id))} />@{member.username}</label>)}
      </fieldset>}
    </details>;
  }
  function renderMessage(comment: Comment) {
    const manageable = user?.id === comment.authorId || user?.role === 'owner';
    return <div className="space-y-2">
      <p className="text-sm"><strong>{comment.authorName || t('comments.formerMember', 'Former member')}</strong>{' '}<time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time></p>
      {comment.deletedAt ? <p className="text-sm italic text-muted-foreground">{t('comments.deleted', 'This comment was deleted.')}</p> : editing === comment.id ? <>
        <label htmlFor={`${inputId}-${comment.id}`}>{t('comments.edit', 'Edit comment')}</label>
        <Textarea id={`${inputId}-${comment.id}`} maxLength={5000} value={editedBody} onChange={event => setEditedBody(event.target.value)} />
        {mentionPicker(editedMentions, setEditedMentions)}
        <Button disabled={busy || !editedBody.trim()} onClick={() => void mutate('PATCH', `/api/comments/${comment.id}`, { body: editedBody.trim(), ...(JSON.stringify(editedMentions) !== JSON.stringify(comment.mentionedUserIds ?? []) ? { mentionedUserIds: editedMentions } : {}) }, () => setEditing(null))}>{t('comments.save', 'Save comment')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t('comments.cancel', 'Cancel')}</Button>
      </> : <>
        <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
        {!!comment.mentionedUserIds?.length && <p className="text-sm text-muted-foreground">{comment.mentionedUserIds.map(id => `@${members.find(m => m.id === id)?.username || t('comments.formerMember', 'Former member')}`).join(' ')}</p>}
      </>}
      {!comment.deletedAt && manageable && editing !== comment.id && <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(comment.id); setEditedBody(comment.body); setEditedMentions(comment.mentionedUserIds ?? []); }}>{t('comments.edit', 'Edit comment')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate('DELETE', `/api/comments/${comment.id}`)}>{t('comments.delete', 'Delete comment')}</Button>
      </div>}
    </div>;
  }
  return <section aria-label={t('comments.title', 'Comments')} className="space-y-4">
    <h3 className="font-semibold">{t('comments.title', 'Comments')}</h3>
    <label className="flex flex-wrap items-center gap-2 text-sm">{t('comments.filter', 'Conversation filter')}<select aria-label={t('comments.filter', 'Conversation filter')} value={filter} onChange={event => setFilter(event.target.value)} className="rounded border bg-background p-2">
      <option value="all">{t('comments.all', 'All conversations')}</option><option value="open">{t('comments.open', 'Open conversations')}</option><option value="resolved">{t('comments.resolved', 'Resolved conversations')}</option><option value="mentions">{t('comments.mentions', 'Mentioning me')}</option>
    </select></label>
    {isLoading && <p role="status">{t('comments.loading', 'Loading comments…')}</p>}
    {(error || failure) && <p role="alert" className="text-destructive">{failure || (error as Error).message}</p>}
    {data?.length === 0 && <p className="text-sm text-muted-foreground">{t('comments.empty', 'No comments yet.')}</p>}
    <ul className="space-y-3">{data?.filter(comment => !comment.parentId).map(root => <li key={root.id} className="rounded border p-3 space-y-3">
      {renderMessage(root)}
      {root.resolvedAt && <p className="text-sm text-muted-foreground">{t('comments.resolvedStatus', 'Resolved')}</p>}
      <ul className="space-y-3 border-l pl-4">{data.filter(comment => comment.parentId === root.id).map(reply => <li key={reply.id}>{renderMessage(reply)}</li>)}</ul>
      {!root.deletedAt && <div className="flex flex-wrap gap-2">
        {!root.resolvedAt && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setReplying(root.id); setReplyBody(''); setReplyMentions([]); }}>{t('comments.reply', 'Reply')}</Button>}
        {(user?.id === root.authorId || user?.role === 'owner') && <Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate('PATCH', `/api/comments/${root.id}/resolution`, { resolved: !root.resolvedAt })}>{root.resolvedAt ? t('comments.reopen', 'Reopen conversation') : t('comments.resolve', 'Resolve conversation')}</Button>}
      </div>}
      {replying === root.id && !root.resolvedAt && !root.deletedAt && <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (replyBody.trim()) void mutate('POST', url, { body: replyBody.trim(), parentId: root.id, ...(replyMentions.length ? { mentionedUserIds: replyMentions } : {}) }, () => { setReplying(null); setReplyBody(''); setReplyMentions([]); }); }}>
        <label htmlFor={`${inputId}-reply-${root.id}`}>{t('comments.replyMessage', 'Reply message')}</label><Textarea id={`${inputId}-reply-${root.id}`} value={replyBody} maxLength={5000} disabled={busy} onChange={event => setReplyBody(event.target.value)} />
        {mentionPicker(replyMentions, setReplyMentions)}
        <Button type="submit" disabled={busy || !replyBody.trim()}>{t('comments.addReply', 'Add reply')}</Button><Button type="button" variant="ghost" onClick={() => setReplying(null)}>{t('comments.cancel', 'Cancel')}</Button>
      </form>}
    </li>)}</ul>
    {user && <form onSubmit={event => { event.preventDefault(); if (draft.trim()) void mutate('POST', url, { body: draft.trim(), ...(draftMentions.length ? { mentionedUserIds: draftMentions } : {}) }, () => { setDraft(''); setDraftMentions([]); }); }} className="space-y-2">
      <label htmlFor={inputId}>{t('comments.new', 'New comment')}</label>
      <Textarea id={inputId} maxLength={5000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
      {mentionPicker(draftMentions, setDraftMentions)}
      <Button type="submit" disabled={busy || !draft.trim()}>{t('comments.add', 'Add comment')}</Button>
    </form>}
  </section>;
}
