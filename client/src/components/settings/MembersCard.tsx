import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, Copy, KeyRound, Loader2, Mail, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

type Role = 'viewer' | 'editor' | 'owner';

interface Member {
  id: number;
  username: string;
  role: Role;
  createdAt: string;
}

interface Invitation {
  id: number;
  username: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
}

interface CreatedInvitation extends Invitation {
  token: string;
}

async function send(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `${method} ${url} failed`);
  return payload;
}

/** The address an invitee opens: the sign-in page, with the form already filled in. */
export function invitationLink(origin: string, invitation: { token: string; username: string }): string {
  const query = new URLSearchParams({ invitation: invitation.token, username: invitation.username });
  return `${origin}/auth?${query.toString()}`;
}

/**
 * Who is in the organization, and who has been asked to join.
 *
 * All of this used to be reachable only through the API: an owner who wanted a colleague in had
 * to call POST /api/organization/invitations by hand, and the colleague had nowhere to put the
 * token. Owners only — the server enforces it; this card is simply not shown to anyone else.
 *
 * Removing a member hands what they made to another member (server/member-removal.ts); the
 * dialog says so and lets the owner choose who.
 */
const MembersCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('editor');
  const [inviteError, setInviteError] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [heir, setHeir] = useState<string>('');
  const [notice, setNotice] = useState('');

  const organization = useQuery<{ members: Member[] }>({
    queryKey: ['organization'],
    queryFn: () => send('GET', '/api/organization'),
  });
  const invitations = useQuery<Invitation[]>({
    queryKey: ['organizationInvitations'],
    queryFn: () => send('GET', '/api/organization/invitations'),
  });

  const members = organization.data?.members ?? [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['organization'] });
    queryClient.invalidateQueries({ queryKey: ['organizationInvitations'] });
  };

  const invite = useMutation({
    mutationFn: () =>
      send('POST', '/api/organization/invitations', { username: inviteUsername.trim(), role: inviteRole }) as Promise<CreatedInvitation>,
    onSuccess: (invitation) => {
      setCreated(invitation);
      setCopied(false);
      setInviteUsername('');
      refresh();
    },
    onError: (error: Error) => setInviteError(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => send('DELETE', `/api/organization/invitations/${id}`),
    onSuccess: refresh,
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => send('PATCH', `/api/organization/members/${id}`, { role }),
    onSuccess: refresh,
    onError: (error: Error) => setNotice(error.message),
  });

  const resetMfa = useMutation({
    mutationFn: (member: Member) => send('DELETE', `/api/organization/members/${member.id}/mfa`).then(() => member),
    onSuccess: (member) =>
      setNotice(
        t('settings.members.mfaReset', 'Two-factor authentication was reset for {{username}}.', { username: member.username }),
      ),
    onError: (error: Error) => setNotice(error.message),
  });

  const remove = useMutation({
    mutationFn: (member: Member) =>
      send('DELETE', `/api/organization/members/${member.id}`, heir ? { transferTo: Number(heir) } : {}) as Promise<{
        transferredTo: { username: string };
      }>,
    onSuccess: (result, member) => {
      setRemoving(null);
      setNotice(
        t('settings.members.removed', '{{username}} was removed. What they made now belongs to {{heir}}.', {
          username: member.username,
          heir: result.transferredTo.username,
        }),
      );
      refresh();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const handleInvite = () => {
    if (inviteUsername.trim().length < 3) {
      setInviteError(t('settings.members.usernameRequired', 'Enter the username the new account will have, at least 3 characters.'));
      return;
    }
    setInviteError('');
    invite.mutate();
  };

  const link = created ? invitationLink(window.location.origin, created) : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const openRemove = (member: Member) => {
    setRemoving(member);
    setHeir('');
  };

  const pending = (invitations.data ?? []).filter((invitation) => !invitation.acceptedAt);
  const expired = (invitation: Invitation) => new Date(invitation.expiresAt).getTime() < Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.members.title', 'Members')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.members.description',
            'Who belongs to this organization and with which role. New people join through an invitation you send them.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {notice && (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}

        {organization.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('settings.members.loading', 'Loading members…')}</p>
        ) : organization.error ? (
          <p className="text-sm text-destructive">{(organization.error as Error).message}</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => {
              const isMe = member.id === user?.id;
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-2 p-2 border rounded-md" data-testid={`member-${member.id}`}>
                  <span className="text-sm font-medium flex-1 min-w-[8rem]">
                    {member.username}
                    {isMe && (
                      <Badge variant="secondary" className="ml-2">
                        {t('settings.members.you', 'you')}
                      </Badge>
                    )}
                  </span>
                  <Select
                    value={member.role}
                    onValueChange={(role) => changeRole.mutate({ id: member.id, role: role as Role })}
                    disabled={changeRole.isPending}
                  >
                    <SelectTrigger className="w-32" aria-label={t('settings.members.roleOf', 'Role of {{username}}', { username: member.username })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">{t('settings.members.roles.viewer', 'viewer')}</SelectItem>
                      <SelectItem value="editor">{t('settings.members.roles.editor', 'editor')}</SelectItem>
                      <SelectItem value="owner">{t('settings.members.roles.owner', 'owner')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {!isMe && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resetMfa.mutate(member)}
                      disabled={resetMfa.isPending}
                      aria-label={t('settings.members.resetMfa', 'Reset two-factor for {{username}}', { username: member.username })}
                      title={t('settings.members.resetMfa', 'Reset two-factor for {{username}}', { username: member.username })}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openRemove(member)}
                    aria-label={t('settings.members.remove', 'Remove {{username}}', { username: member.username })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            {t('settings.members.inviteTitle', 'Invite someone')}
          </h4>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <Label htmlFor="inviteUsername">{t('settings.members.usernameLabel', 'Username for the new account')}</Label>
              <Input
                id="inviteUsername"
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
                placeholder="maria.rossi"
                className="mt-1"
              />
            </div>
            <div className="w-full sm:w-36">
              <Label>{t('settings.members.roleLabel', 'Role')}</Label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as 'viewer' | 'editor')}>
                <SelectTrigger className="mt-1" aria-label={t('settings.members.roleLabel', 'Role')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">{t('settings.members.roles.viewer', 'viewer')}</SelectItem>
                  <SelectItem value="editor">{t('settings.members.roles.editor', 'editor')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleInvite} disabled={invite.isPending}>
              {invite.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('settings.members.inviteAction', 'Create invitation')}
            </Button>
          </div>
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}

          {created && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="invitation-link">
              <p className="text-sm">
                {t(
                  'settings.members.linkIntro',
                  'Send this link to {{username}}. It is shown only now, and works for seven days.',
                  { username: created.username },
                )}
              </p>
              <div className="flex gap-2">
                <Input readOnly value={link} className="font-mono text-xs" aria-label={t('settings.members.linkLabel', 'Invitation link')} />
                <Button variant="outline" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span className="ml-2">{copied ? t('settings.members.copied', 'Copied') : t('settings.members.copy', 'Copy')}</span>
                </Button>
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <ul className="space-y-2">
              {pending.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between p-2 border rounded-md text-sm" data-testid={`invitation-${invitation.id}`}>
                  <span>
                    <span className="font-medium">{invitation.username}</span>
                    <Badge variant="outline" className="ml-2">
                      {t(`settings.members.roles.${invitation.role}`, invitation.role)}
                    </Badge>
                    <Badge variant={expired(invitation) ? 'secondary' : 'outline'} className="ml-2">
                      {expired(invitation)
                        ? t('settings.members.expired', 'expired')
                        : t('settings.members.pending', 'waiting until {{date}}', {
                            date: new Date(invitation.expiresAt).toLocaleDateString(),
                          })}
                    </Badge>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revoke.mutate(invitation.id)}
                    disabled={revoke.isPending}
                    aria-label={t('settings.members.revoke', 'Revoke the invitation for {{username}}', { username: invitation.username })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('settings.members.removeTitle', 'Remove {{username}}?', { username: removing?.username ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.members.removeDescription',
                'Their account is deleted, with their API keys and preferences. The projects, tests, plans, schedules and environments they made stay in the organization and are handed to the member you choose. The audit log keeps their name.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t('settings.members.heirLabel', 'Hand what they made to')}</Label>
            <Select value={heir || 'default'} onValueChange={(value) => setHeir(value === 'default' ? '' : value)}>
              <SelectTrigger aria-label={t('settings.members.heirLabel', 'Hand what they made to')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {removing?.id === user?.id
                    ? t('settings.members.heirOtherOwner', 'another owner')
                    : t('settings.members.heirMe', 'me')}
                </SelectItem>
                {members
                  .filter((member) => member.id !== removing?.id && member.id !== user?.id)
                  .map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.username}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t('settings.members.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" onClick={() => removing && remove.mutate(removing)} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('settings.members.removeConfirm', 'Remove member')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default MembersCard;
