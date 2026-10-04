import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ProtocolConfigSchema,
  PROTOCOL_DEFAULTS,
  PROTOCOL_HARD_LIMITS,
  type ProtocolConfig,
} from '@shared/api-protocol-config';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function ProtocolConfigEditor({
  method,
  value,
  onChange,
  disabled = false,
}: {
  method: string;
  value: ProtocolConfig | null;
  onChange: (value: ProtocolConfig | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const config = value ?? {};
  const valid = ProtocolConfigSchema.safeParse(config).success;
  const copy = (key: string, fallback: string) => t(`apiTester.protocol.${key}`, fallback);
  const limit = (name: 'timeoutMs' | 'maxMessages' | 'maxBytes', label: string) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        type="number"
        min={1}
        max={PROTOCOL_HARD_LIMITS[name]}
        placeholder={String(PROTOCOL_DEFAULTS[name])}
        value={config[name] ?? ''}
        onChange={(event) =>
          onChange({
            ...config,
            [name]: event.target.value === '' ? undefined : Number(event.target.value),
          })
        }
      />
    </label>
  );
  const secret = (name: keyof NonNullable<ProtocolConfig['tls']>, label: string) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        autoComplete="off"
        spellCheck={false}
        placeholder={`{{secret_${name}}}`}
        value={config.tls?.[name] ?? ''}
        onChange={(event) =>
          onChange({ ...config, tls: { ...config.tls, [name]: event.target.value || undefined } })
        }
      />
    </label>
  );
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-4">
      <legend className="px-1 text-sm font-medium">
        {copy('title', 'Protocol configuration')}
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {limit('timeoutMs', copy('timeout', 'Overall timeout (ms)'))}
        {limit('maxMessages', copy('maxMessages', 'Maximum received messages'))}
        {limit('maxBytes', copy('maxBytes', 'Maximum received bytes'))}
      </div>
      {method === 'GRPC' && (
        <>
          <label className="grid gap-1 text-sm">
            {copy('mode', 'gRPC mode')}
            <select
              aria-label={copy('mode', 'gRPC mode')}
              className="rounded-md border bg-background p-2"
              value={config.grpcMode ?? 'auto'}
              onChange={(event) =>
                onChange({ ...config, grpcMode: event.target.value as ProtocolConfig['grpcMode'] })
              }
            >
              <option value="auto">{copy('auto', 'From service definition')}</option>
              <option value="unary">{copy('unary', 'Unary')}</option>
              <option value="server_stream">{copy('serverStream', 'Server stream')}</option>
              <option value="client_stream">{copy('clientStream', 'Client stream')}</option>
              <option value="bidi">{copy('bidi', 'Bidirectional stream')}</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            {copy(
              'tlsHelp',
              'TLS requires grpcs://. Use exact environment secret references; supply the client certificate and key together. Certificates are always verified.',
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {secret('rootCa', copy('rootCa', 'Root CA secret reference'))}
            {secret(
              'clientCertificate',
              copy('clientCertificate', 'Client certificate secret reference'),
            )}
            {secret('clientKey', copy('clientKey', 'Client key secret reference'))}
            {secret('keyPassphrase', copy('keyPassphrase', 'Key passphrase secret reference'))}
          </div>
        </>
      )}
      {!valid && (
        <p role="alert" className="text-sm text-destructive">
          {copy(
            'invalid',
            'Check the protocol limits and exact secret references. Client certificate and key must be supplied together.',
          )}
        </p>
      )}
      {value && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          {copy('defaults', 'Use protocol defaults')}
        </Button>
      )}
    </fieldset>
  );
}
