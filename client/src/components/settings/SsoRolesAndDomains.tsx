import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Loader2, PlusCircle, XCircle } from 'lucide-react';

/**
 * Two parts of the single sign-on card (shared/sso-roles.ts):
 * - DomainVerification: each domain's TXT record, and a Verify button (server/sso-domains.ts);
 * - RoleMappingEditor: the provider's groups → roles, applied at every sign-in.
 */

export interface DomainStatus {
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  record: { name: string; value: string } | null;
}

export interface RoleMappingRow {
  group: string;
  role: 'viewer' | 'editor' | 'owner';
}

export function DomainVerification({ domains, required, onVerified }: { domains: DomainStatus[]; required: boolean; onVerified: () => void }) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const verify = async (domain: string) => {
    setChecking(domain);
    try {
      const response = await fetch(`/api/organization/sso/domains/${encodeURIComponent(domain)}/verify`, { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setMessages((current) => ({ ...current, [domain]: body.verified ? '' : body.message }));
      if (body.verified) onVerified();
    } catch (error) {
      setMessages((current) => ({ ...current, [domain]: (error as Error).message }));
    } finally {
      setChecking(null);
    }
  };

  if (domains.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="sso-domain-verification">
      <p className="text-sm font-medium">{t('sso.domainsProof.title', 'Proof of the domains')}</p>
      <p className="text-xs text-muted-foreground">
        {required
          ? t('sso.domainsProof.required', 'On this installation a domain signs nobody in until it is proven: publish its TXT record, then press Verify.')
          : t('sso.domainsProof.advice', 'Proving a domain is optional here, and shows your provider is really yours: publish its TXT record, then press Verify.')}
      </p>
      <ul className="space-y-2">
        {domains.map((d) => (
          <li key={d.domain} className="space-y-1 text-xs" data-testid="sso-domain-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{d.domain}</span>
              {d.verified ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {t('sso.domainsProof.verified', 'proven')}
                </Badge>
              ) : (
                <>
                  <Badge variant="outline">{t('sso.domainsProof.unverified', 'not proven')}</Badge>
                  <Button type="button" size="sm" variant="outline" className="h-7" disabled={checking !== null} onClick={() => verify(d.domain)}>
                    {checking === d.domain && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {t('sso.domainsProof.verify', 'Verify')}
                  </Button>
                </>
              )}
            </div>
            {!d.verified && d.record && (
              <p className="text-muted-foreground">
                {t('sso.domainsProof.record', 'TXT record')} <code className="font-mono">{d.record.name}</code> = <code className="font-mono break-all">{d.record.value}</code>
              </p>
            )}
            {messages[d.domain] && <p className="text-destructive">{messages[d.domain]}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoleMappingEditor({
  attribute,
  mappings,
  requireGroup,
  onChange,
}: {
  attribute: string;
  mappings: RoleMappingRow[];
  requireGroup: boolean;
  onChange: (next: { attribute: string; mappings: RoleMappingRow[]; requireGroup: boolean }) => void;
}) {
  const { t } = useTranslation();
  const set = (next: Partial<{ attribute: string; mappings: RoleMappingRow[]; requireGroup: boolean }>) => onChange({ attribute, mappings, requireGroup, ...next });
  const roleLabel = (role: RoleMappingRow['role']) =>
    role === 'owner' ? t('sso.roleOwner', 'Owner') : role === 'editor' ? t('sso.roleEditor', 'Editor') : t('sso.roleViewer', 'Viewer');

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="sso-role-mappings">
      <p className="text-sm font-medium">{t('sso.groups.title', 'Roles from the provider\'s groups')}</p>
      <p className="text-xs text-muted-foreground">
        {t(
          'sso.groups.hint',
          'At every sign-in the role follows the groups the provider sends: the highest role any of them maps to. With no mapping, roles are managed here in Members.',
        )}
      </p>
      <div className="max-w-xs space-y-1">
        <Label htmlFor="sso-group-attribute" className="text-xs">
          {t('sso.groups.attribute', 'Claim or attribute with the groups')}
        </Label>
        <Input id="sso-group-attribute" className="h-8 font-mono text-xs" value={attribute} placeholder="groups" onChange={(e) => set({ attribute: e.target.value })} />
      </div>
      {mappings.map((mapping, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2" data-testid="sso-mapping-row">
          <Input
            className="h-8 flex-1 font-mono text-xs"
            value={mapping.group}
            placeholder={t('sso.groups.groupPlaceholder', 'Group name or id')}
            aria-label={t('sso.groups.group', 'Group of mapping {{n}}', { n: index + 1 })}
            onChange={(e) => set({ mappings: mappings.map((m, i) => (i === index ? { ...m, group: e.target.value } : m)) })}
          />
          <Select value={mapping.role} onValueChange={(role) => set({ mappings: mappings.map((m, i) => (i === index ? { ...m, role: role as RoleMappingRow['role'] } : m)) })}>
            <SelectTrigger className="h-8 w-32" aria-label={t('sso.groups.role', 'Role of mapping {{n}}', { n: index + 1 })}>
              <SelectValue>{roleLabel(mapping.role)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">{t('sso.roleViewer', 'Viewer')}</SelectItem>
              <SelectItem value="editor">{t('sso.roleEditor', 'Editor')}</SelectItem>
              <SelectItem value="owner">{t('sso.roleOwner', 'Owner')}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('sso.groups.remove', 'Remove mapping {{n}}', { n: index + 1 })} onClick={() => set({ mappings: mappings.filter((_, i) => i !== index) })}>
            <XCircle className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => set({ mappings: [...mappings, { group: '', role: 'viewer' }] })}>
        <PlusCircle className="mr-1 h-4 w-4" /> {t('sso.groups.add', 'Map a group')}
      </Button>
      <label className="flex items-start gap-2 pt-1 text-sm">
        <Switch checked={requireGroup} disabled={mappings.length === 0} onCheckedChange={(value) => set({ requireGroup: value })} aria-label={t('sso.groups.require', 'Refuse whoever is in none of these groups')} />
        <span>
          {t('sso.groups.require', 'Refuse whoever is in none of these groups')}
          <span className="block text-xs text-muted-foreground">
            {t('sso.groups.requireHint', 'Then removing someone from the groups at the provider ends their access here at their next sign-in.')}
          </span>
        </span>
      </label>
    </div>
  );
}
