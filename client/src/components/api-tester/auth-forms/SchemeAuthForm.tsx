import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuthParamsSchema, JWT_ALGORITHMS, type AuthParams, type AuthType } from '@shared/schema';

/**
 * The settings of the eight schemes that used to be names in the dropdown: JWT Bearer, Digest,
 * OAuth 1.0, Hawk, AWS Signature, NTLM, Akamai EdgeGrid and Atlassian ASAP. What each field
 * does is decided by the runner (server/api-auth.ts); this form only collects them.
 *
 * One form described by a table rather than eight components that differ only in their
 * fields: the table is the list of what each scheme asks for, and the next scheme is a row.
 */

export type SchemeType = 'jwtBearer' | 'digest' | 'oauth1' | 'hawk' | 'aws' | 'ntlm' | 'akamai' | 'asap';
export const SCHEME_TYPES: readonly SchemeType[] = ['jwtBearer', 'digest', 'oauth1', 'hawk', 'aws', 'ntlm', 'akamai', 'asap'];

type Params = Record<string, string | number | boolean>;

interface Field {
  key: string;
  kind: 'text' | 'secret' | 'multiline' | 'number' | 'check' | 'select';
  options?: readonly string[];
  /** Shown only when the rest of the settings make it matter. */
  when?: (params: Params) => boolean;
  /** A key pasted as PEM spans lines; a shared secret does not. */
  kindFor?: (params: Params) => Field['kind'];
  placeholder?: string;
}

const isHmac = (params: Params) => String(params.algorithm ?? '').startsWith('HS');

const FIELDS: Record<SchemeType, Field[]> = {
  jwtBearer: [
    { key: 'algorithm', kind: 'select', options: JWT_ALGORITHMS },
    { key: 'secret', kind: 'secret', kindFor: (p) => (isHmac(p) ? 'secret' : 'multiline'), placeholder: '{{jwtSecret}}' },
    { key: 'secretBase64', kind: 'check', when: isHmac },
    { key: 'payload', kind: 'multiline', placeholder: '{"sub": "{{userId}}"}' },
    { key: 'headers', kind: 'multiline', placeholder: '{"kid": "key-1"}' },
    { key: 'addTo', kind: 'select', options: ['header', 'query'] },
    { key: 'headerPrefix', kind: 'text', when: (p) => p.addTo !== 'query' },
    { key: 'queryParam', kind: 'text', when: (p) => p.addTo === 'query' },
  ],
  digest: [
    { key: 'username', kind: 'text' },
    { key: 'password', kind: 'secret' },
  ],
  oauth1: [
    { key: 'signatureMethod', kind: 'select', options: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'PLAINTEXT'] },
    { key: 'consumerKey', kind: 'text' },
    { key: 'consumerSecret', kind: 'secret' },
    { key: 'token', kind: 'text' },
    { key: 'tokenSecret', kind: 'secret' },
    { key: 'realm', kind: 'text' },
    { key: 'addTo', kind: 'select', options: ['header', 'query'] },
  ],
  hawk: [
    { key: 'authId', kind: 'text' },
    { key: 'authKey', kind: 'secret' },
    { key: 'algorithm', kind: 'select', options: ['sha256', 'sha1'] },
    { key: 'ext', kind: 'text' },
    { key: 'includePayloadHash', kind: 'check' },
  ],
  aws: [
    { key: 'accessKey', kind: 'text' },
    { key: 'secretKey', kind: 'secret' },
    { key: 'sessionToken', kind: 'secret' },
    { key: 'region', kind: 'text', placeholder: 'eu-west-1' },
    { key: 'service', kind: 'text', placeholder: 'execute-api' },
  ],
  ntlm: [
    { key: 'username', kind: 'text', placeholder: 'CORP\\alice' },
    { key: 'password', kind: 'secret' },
    { key: 'domain', kind: 'text' },
    { key: 'workstation', kind: 'text' },
  ],
  akamai: [
    { key: 'clientToken', kind: 'text' },
    { key: 'clientSecret', kind: 'secret' },
    { key: 'accessToken', kind: 'text' },
    { key: 'headersToSign', kind: 'text' },
    { key: 'maxBody', kind: 'number' },
  ],
  asap: [
    { key: 'algorithm', kind: 'select', options: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] },
    { key: 'issuer', kind: 'text' },
    { key: 'audience', kind: 'text' },
    { key: 'keyId', kind: 'text' },
    { key: 'privateKey', kind: 'multiline', placeholder: '-----BEGIN PRIVATE KEY-----' },
    { key: 'subject', kind: 'text' },
    { key: 'expirySeconds', kind: 'number' },
    { key: 'additionalClaims', kind: 'multiline' },
  ],
};

export const isSchemeType = (type: AuthType): type is SchemeType => (SCHEME_TYPES as readonly string[]).includes(type);

/** The scheme's settings with every field filled from the schema, as the runner will read them. */
export function schemeDefaults(type: SchemeType, params?: unknown): Params {
  const parsed = AuthParamsSchema.safeParse({ type, params: params ?? {} });
  const fallback = AuthParamsSchema.parse({ type }) as { params: Params };
  return parsed.success ? (parsed.data as { params: Params }).params : fallback.params;
}

interface SchemeAuthFormProps {
  type: SchemeType;
  params: unknown;
  onChange: (next: AuthParams) => void;
  disabled?: boolean;
}

export const SchemeAuthForm: React.FC<SchemeAuthFormProps> = ({ type, params, onChange, disabled = false }) => {
  const { t } = useTranslation();
  const current = schemeDefaults(type, params);
  // The whole settings object each time, as the other forms do: a partial update would drop
  // what the tester already entered.
  const set = (key: string, value: string | number | boolean) =>
    onChange({ type, params: { ...current, [key]: value } } as AuthParams);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`authForms.schemeHints.${type}`)}</p>
      {FIELDS[type]
        .filter((field) => !field.when || field.when(current))
        .map((field) => {
          const id = `${type}-${field.key}`;
          const label = t(`authForms.schemeFields.${field.key}.label`);
          const kind = field.kindFor?.(current) ?? field.kind;
          const value = current[field.key];

          if (kind === 'check') {
            return (
              <div key={field.key} className="flex items-center gap-2">
                <Checkbox id={id} checked={Boolean(value)} onCheckedChange={(checked) => set(field.key, checked === true)} disabled={disabled} />
                <Label htmlFor={id}>{label}</Label>
              </div>
            );
          }
          return (
            <div key={field.key}>
              <Label htmlFor={id}>{label}</Label>
              {kind === 'select' ? (
                <Select value={String(value)} onValueChange={(next) => set(field.key, next)} disabled={disabled}>
                  <SelectTrigger id={id} className="w-full mt-1" aria-label={label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options!.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'header' || option === 'query' ? t(`authForms.schemeFields.addTo.${option}`) : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : kind === 'multiline' ? (
                <Textarea
                  id={id}
                  value={String(value ?? '')}
                  onChange={(e) => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={disabled}
                  rows={4}
                  className="mt-1 font-mono text-xs"
                  spellCheck={false}
                />
              ) : (
                <Input
                  id={id}
                  type={kind === 'secret' ? 'password' : kind === 'number' ? 'number' : 'text'}
                  value={String(value ?? '')}
                  onChange={(e) => {
                    if (kind !== 'number') return set(field.key, e.target.value);
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n > 0) set(field.key, n);
                  }}
                  placeholder={field.placeholder}
                  disabled={disabled}
                  className="mt-1"
                  autoComplete="off"
                />
              )}
            </div>
          );
        })}
    </div>
  );
};
