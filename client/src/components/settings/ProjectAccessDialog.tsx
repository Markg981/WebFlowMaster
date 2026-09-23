import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Trash2 } from 'lucide-react';

/**
 * Who can reach a project, and as what. Owners only (the server enforces it).
 *
 * A restricted project is invisible to everyone not listed here except the organization's
 * owners. A role here can only narrow what a member's organization role allows: listing a viewer
 * as an editor does not let them edit.
 */

interface Member {
  userId: number;
  username: string;
  role: 'viewer' | 'editor';
}

interface Access {
  projectId: number;
  name: string;
  restricted: boolean;
  members: Member[];
}

interface OrganizationMember {
  id: number;
  username: string;
  role: string;
}

export default function ProjectAccessDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [restricted, setRestricted] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: access } = useQuery<Access>({
    queryKey: ['projectAccess', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/access`, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the project access');
      return response.json();
    },
    enabled: open,
  });
  const { data: organization } = useQuery<{ members: OrganizationMember[] }>({
    queryKey: ['organization'],
    queryFn: async () => {
      const response = await fetch('/api/organization', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the members');
      return response.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (access) {
      setRestricted(access.restricted);
      setMembers(access.members);
      setError('');
    }
  }, [access]);

  // Owners see every project anyway; listing them would only suggest otherwise.
  const candidates = (organization?.members ?? []).filter(
    (m) => m.role !== 'owner' && !members.some((listed) => listed.userId === m.id),
  );

  const add = (value: string) => {
    const person = candidates.find((m) => String(m.id) === value);
    if (person) setMembers([...members, { userId: person.id, username: person.username, role: 'viewer' }]);
    setAdding('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ restricted, members: members.map(({ userId, role }) => ({ userId, role })) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not save');
      queryClient.invalidateQueries({ queryKey: ['projectAccess', projectId] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('projectAccess.title', 'Who can reach {{name}}', { name: access?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t(
              'projectAccess.description',
              'Restricted, the project and its tests are visible only to owners and the people listed here. A role here never gives more than the person’s role in the organization.',
            )}
          </DialogDescription>
        </DialogHeader>

        {!access ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="project-restricted">{t('projectAccess.restricted', 'Restricted')}</Label>
              <Switch id="project-restricted" checked={restricted} onCheckedChange={setRestricted} />
            </div>

            <ul className="space-y-2" data-testid="project-members">
              {members.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{member.username}</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.role}
                      onValueChange={(role) =>
                        setMembers(members.map((m) => (m.userId === member.userId ? { ...m, role: role as Member['role'] } : m)))
                      }
                    >
                      <SelectTrigger className="w-28" aria-label={t('projectAccess.roleFor', 'Role of {{name}}', { name: member.username })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">{t('projectAccess.roles.viewer', 'viewer')}</SelectItem>
                        <SelectItem value="editor">{t('projectAccess.roles.editor', 'editor')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('projectAccess.remove', 'Remove {{name}}', { name: member.username })}
                      onClick={() => setMembers(members.filter((m) => m.userId !== member.userId))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {members.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  {restricted
                    ? t('projectAccess.onlyOwners', 'Nobody is listed: only owners can reach it.')
                    : t('projectAccess.none', 'Nobody is listed.')}
                </li>
              )}
            </ul>

            {candidates.length > 0 && (
              <Select value={adding} onValueChange={add}>
                <SelectTrigger aria-label={t('projectAccess.add', 'Add a member')}>
                  <SelectValue placeholder={t('projectAccess.add', 'Add a member')} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('projectAccess.cancel', 'Cancel')}
          </Button>
          <Button onClick={save} disabled={!access || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('projectAccess.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
