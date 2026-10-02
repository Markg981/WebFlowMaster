import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export interface SamlAdvancedForm {
  samlAllowIdpInitiated: boolean;
  samlRequireEncryptedAssertions: boolean;
  samlSloUrl: string;
  samlSpCertificate: string;
  samlSpPrivateKey: string;
  samlClearSpKey: boolean;
}

export default function SamlAdvancedSettings({ value, privateKeyConfigured, disabled, onChange }: {
  value: SamlAdvancedForm;
  privateKeyConfigured: boolean;
  disabled: boolean;
  onChange: (next: SamlAdvancedForm) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof SamlAdvancedForm>(key: K, next: SamlAdvancedForm[K]) => onChange({ ...value, [key]: next });
  const keyNeeded = value.samlRequireEncryptedAssertions || !!value.samlSloUrl.trim();
  return <fieldset disabled={disabled} className="space-y-4 border-t pt-4">
    <legend className="px-1 text-sm font-semibold">{t('sso.saml.advanced', 'Advanced SAML settings')}</legend>
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor="sso-saml-idp-initiated">{t('sso.saml.allowIdpInitiated', 'Allow identity provider initiated sign-in')}</Label>
        <p className="max-w-2xl text-xs text-muted-foreground">{t('sso.saml.idpInitiatedCaution', 'Off by default. Unsolicited sign-in can sign this browser into another account without a login request from WebFlowMaster. Enable only when you trust your provider’s launch flow. Signatures, audience, time limits, domain checks and replay protection still apply.')}</p>
      </div>
      <Switch id="sso-saml-idp-initiated" checked={value.samlAllowIdpInitiated} onCheckedChange={next => set('samlAllowIdpInitiated', next)} />
    </div>
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor="sso-saml-encrypted">{t('sso.saml.requireEncrypted', 'Require encrypted assertions')}</Label>
        <p className="text-xs text-muted-foreground">{t('sso.saml.encryptedHint', 'Requires a matching service provider certificate and private key. Configure your provider to encrypt assertions with this public certificate.')}</p>
      </div>
      <Switch id="sso-saml-encrypted" checked={value.samlRequireEncryptedAssertions} disabled={value.samlClearSpKey} onCheckedChange={next => set('samlRequireEncryptedAssertions', next)} />
    </div>
    <div className="space-y-1">
      <Label htmlFor="sso-saml-idp-slo">{t('sso.saml.idpSloUrl', 'Provider single logout URL (optional)')}</Label>
      <Input id="sso-saml-idp-slo" type="url" value={value.samlSloUrl} disabled={value.samlClearSpKey} onChange={event => set('samlSloUrl', event.target.value)} placeholder="https://idp.example.com/saml/logout" />
      <p className="text-xs text-muted-foreground">{t('sso.saml.sloHint', 'Use the provider’s HTTPS HTTP-Redirect logout endpoint. Single logout requires the matching service provider certificate and private key below.')}</p>
    </div>
    <div className="space-y-1">
      <Label htmlFor="sso-saml-sp-cert">{t('sso.saml.spCertificate', 'Service provider certificate')}</Label>
      <Textarea id="sso-saml-sp-cert" className="font-mono text-xs" rows={3} disabled={value.samlClearSpKey} value={value.samlSpCertificate} onChange={event => set('samlSpCertificate', event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
      <p className="text-xs text-muted-foreground">{t('sso.saml.spCertificateHint', 'Public RSA X.509 certificate for signing logout messages and decrypting assertions. The certificate must match the private key.')}</p>
    </div>
    <div className="space-y-1">
      <Label htmlFor="sso-saml-sp-key">{t('sso.saml.spPrivateKey', 'Service provider private key')}</Label>
      <Textarea id="sso-saml-sp-key" className="font-mono text-xs [-webkit-text-security:disc]" autoComplete="off" spellCheck={false} rows={3} disabled={value.samlClearSpKey} value={value.samlSpPrivateKey} onChange={event => set('samlSpPrivateKey', event.target.value)} placeholder={privateKeyConfigured ? t('sso.secretKept', 'Stored. Leave empty to keep it.') : '-----BEGIN PRIVATE KEY-----'} aria-describedby="sso-saml-sp-key-hint" />
      <p id="sso-saml-sp-key-hint" className="text-xs text-muted-foreground">{t('sso.saml.spPrivateKeyHint', 'Paste the RSA PEM private key. It is stored encrypted and never returned. Leave this field blank to retain a stored key.')}</p>
    </div>
    {privateKeyConfigured && <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.samlClearSpKey} disabled={keyNeeded} onChange={event => set('samlClearSpKey', event.target.checked)} />{t('sso.saml.removeSpKey', 'Remove the stored service provider key and certificate')}</label>
      {keyNeeded && <p className="text-xs text-muted-foreground">{t('sso.saml.removeSpKeyHint', 'Turn off required encryption and clear the provider logout URL before removing the key.')}</p>}
    </div>}
  </fieldset>;
}
