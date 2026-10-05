import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bddRequest, type AdvertisedBddProfile, type BddProfile } from '@/lib/api/bdd';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
const targetKey = (p: AdvertisedBddProfile) => `${p.pool}:${p.id}:${p.revision}`;
export default function BddProfilesCard() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [editing, setEditing] = useState<BddProfile | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [projectId, setProjectId] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const advertised = useQuery<{ profiles: AdvertisedBddProfile[] }>({
    queryKey: ['/api/bdd/profiles/available'],
    queryFn: () => bddRequest('/api/bdd/profiles/available'),
  });
  const bindings = useQuery<{ profiles: BddProfile[] }>({
    queryKey: ['/api/bdd/profiles'],
    queryFn: () => bddRequest('/api/bdd/profiles'),
  });
  const projects = useQuery<{ id: number; name: string }[]>({ queryKey: ['/api/projects'] });
  const choices = (advertised.data?.profiles ?? []).filter(
    (p) => !editing || (p.pool === editing.pool && p.id === editing.operatorProfileId),
  );
  const selected = choices.find((p) => targetKey(p) === target);
  const reset = () => {
    setEditing(null);
    setName('');
    setTarget('');
    setProjectId('');
    setTimeoutMs(60000);
    setError('');
  };
  const edit = (p: BddProfile) => {
    setEditing(p);
    setName(p.name);
    setProjectId(p.projectId == null ? '' : String(p.projectId));
    setTarget(`${p.pool}:${p.operatorProfileId}:${p.revision}`);
    setTimeoutMs(p.timeoutMs);
    setError('');
  };
  const refresh = () => client.invalidateQueries({ queryKey: ['/api/bdd/profiles'] });
  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await bddRequest(
        editing ? `/api/bdd/profiles/${editing.id}` : '/api/bdd/profiles',
        editing ? 'PUT' : 'POST',
        {
          name: name.trim(),
          pool: selected.pool,
          operatorProfileId: selected.id,
          revision: selected.revision,
          projectId: projectId ? Number(projectId) : null,
          timeoutMs,
        },
      );
      await refresh();
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: BddProfile) => {
    setBusy(true);
    setError('');
    try {
      await bddRequest(`/api/bdd/profiles/${p.id}`, 'DELETE');
      await refresh();
      if (editing?.id === p.id) reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="bdd-profiles">
      <CardHeader>
        <CardTitle>{t('bdd.profilesTitle', 'Cucumber execution profiles')}</CardTitle>
        <CardDescription>
          {t(
            'bdd.profilesDescription',
            'Bind tests to support projects advertised by your authorized agents. Updating a revision requires tests to be rebound and published.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {bindings.data?.profiles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 border rounded p-2">
              <span>
                {p.name} · {p.pool} · {p.operatorProfileId} · {p.revision}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => edit(p)}
                aria-label={`${t('bdd.editProfile', 'Edit profile')} ${p.name}`}
              >
                {t('bdd.editProfile', 'Edit profile')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => remove(p)}
                aria-label={`${t('bdd.deleteProfile', 'Delete profile')} ${p.name}`}
              >
                {t('bdd.deleteProfile', 'Delete profile')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2">
          <Label htmlFor="bdd-profile-name">{t('bdd.profileName', 'Profile name')}</Label>
          <Input
            id="bdd-profile-name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Label htmlFor="bdd-support-target">
            {t('bdd.supportTarget', 'Advertised support profile')}
          </Label>
          <select
            id="bdd-support-target"
            data-testid="bdd-support-target"
            className="border rounded p-2 bg-background"
            value={selected ? target : ''}
            onChange={(e) => {
              setTarget(e.target.value);
              const p = choices.find((p) => targetKey(p) === e.target.value);
              if (p) setTimeoutMs((current) => Math.min(current, p.maxDurationMs));
            }}
          >
            <option value="">
              {t('bdd.selectSupport', 'Select an advertised support project')}
            </option>
            {choices.map((p) => (
              <option key={targetKey(p)} value={targetKey(p)}>
                {p.label} · {p.pool} · {p.revision} ·{' '}
                {p.connected ? t('bdd.connected', 'Connected') : t('bdd.offline', 'Offline')}
              </option>
            ))}
          </select>
          {editing && (
            <p className="text-xs text-muted-foreground">
              {t(
                'bdd.immutableTarget',
                'Pool and support project are fixed for this binding. Create a new profile to change the execution target.',
              )}
            </p>
          )}
          {!choices.length && (
            <p>
              {t(
                'bdd.noAdvertised',
                'No authorized agent advertises a Cucumber support profile. Provision an agent support project first.',
              )}
            </p>
          )}
          <Label htmlFor="bdd-profile-project">{t('bdd.project', 'Project')}</Label>
          <select
            id="bdd-profile-project"
            className="border rounded p-2 bg-background"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t('bdd.organizationWide', 'All organization projects')}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Label htmlFor="bdd-profile-timeout">{t('bdd.timeout', 'Maximum duration (ms)')}</Label>
          <Input
            id="bdd-profile-timeout"
            type="number"
            min={1000}
            max={selected?.maxDurationMs ?? 300000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
          />
        </div>
        {(error || advertised.error || bindings.error) && (
          <p role="alert" className="text-destructive">
            {error || advertised.error?.message || bindings.error?.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={save}
            data-testid="bdd-profile-save"
            disabled={
              busy ||
              !name.trim() ||
              !selected ||
              timeoutMs < 1000 ||
              timeoutMs > selected.maxDurationMs
            }
          >
            {t('bdd.saveProfile', 'Save profile')}
          </Button>
          {editing && (
            <Button variant="outline" onClick={reset} disabled={busy}>
              {t('bdd.cancelEdit', 'Cancel edit')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
