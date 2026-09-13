import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OAuth2AuthParams } from '@shared/schema';

/**
 * OAuth 2.0 settings.
 *
 * The token is fetched by the server when the request runs, not here and not when this form
 * is filled in: the token endpoint is a different origin than this app, and a client secret
 * typed into a browser and sent from it is a client secret in everyone's network tab.
 *
 * Every field accepts `{{name}}`, which is the point of putting them on the server — the
 * environment's values live there, so a secret can be stored once and referenced instead of
 * pasted into each test.
 */

interface OAuth2AuthFormProps {
  params: Partial<OAuth2AuthParams>;
  onChange: (newParams: OAuth2AuthParams) => void;
  disabled?: boolean;
}

const EMPTY: OAuth2AuthParams = {
  grantType: 'client_credentials',
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
  scope: '',
  username: '',
  password: '',
  clientAuth: 'header',
};

export const OAuth2AuthForm: React.FC<OAuth2AuthFormProps> = ({
  params,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const current: OAuth2AuthParams = { ...EMPTY, ...params };
  const set = <K extends keyof OAuth2AuthParams>(key: K, value: OAuth2AuthParams[K]) =>
    onChange({ ...current, [key]: value });

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="oauth2-grant-type">{t('authForms.oauth2AuthForm.grantType.label')}</Label>
        <Select
          value={current.grantType}
          onValueChange={(value) => set('grantType', value as OAuth2AuthParams['grantType'])}
          disabled={disabled}
        >
          <SelectTrigger id="oauth2-grant-type" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="client_credentials">
              {t('authForms.oauth2AuthForm.clientCredentials.text')}
            </SelectItem>
            <SelectItem value="password">
              {t('authForms.oauth2AuthForm.passwordGrant.text')}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {t('authForms.oauth2AuthForm.noAuthorizationCode.help')}
        </p>
      </div>

      <div>
        <Label htmlFor="oauth2-token-url">{t('authForms.oauth2AuthForm.tokenUrl.label')}</Label>
        <Input
          id="oauth2-token-url"
          value={current.tokenUrl}
          onChange={(e) => set('tokenUrl', e.target.value)}
          placeholder={t('authForms.oauth2AuthForm.enterTokenUrl.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="oauth2-client-id">{t('authForms.oauth2AuthForm.clientId.label')}</Label>
          <Input
            id="oauth2-client-id"
            value={current.clientId}
            onChange={(e) => set('clientId', e.target.value)}
            placeholder={t('authForms.oauth2AuthForm.enterClientId.placeholder')}
            disabled={disabled}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="oauth2-client-secret">
            {t('authForms.oauth2AuthForm.clientSecret.label')}
          </Label>
          <Input
            id="oauth2-client-secret"
            type="password"
            value={current.clientSecret}
            onChange={(e) => set('clientSecret', e.target.value)}
            placeholder={t('authForms.oauth2AuthForm.enterClientSecret.placeholder')}
            disabled={disabled}
            className="mt-1"
          />
        </div>
      </div>

      {current.grantType === 'password' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="oauth2-username">{t('authForms.oauth2AuthForm.username.label')}</Label>
            <Input
              id="oauth2-username"
              value={current.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder={t('authForms.oauth2AuthForm.enterUsername.placeholder')}
              disabled={disabled}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="oauth2-password">{t('authForms.oauth2AuthForm.password.label')}</Label>
            <Input
              id="oauth2-password"
              type="password"
              value={current.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder={t('authForms.oauth2AuthForm.enterPassword.placeholder')}
              disabled={disabled}
              className="mt-1"
            />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="oauth2-scope">{t('authForms.oauth2AuthForm.scope.label')}</Label>
        <Input
          id="oauth2-scope"
          value={current.scope}
          onChange={(e) => set('scope', e.target.value)}
          placeholder={t('authForms.oauth2AuthForm.enterScope.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="oauth2-client-auth">{t('authForms.oauth2AuthForm.clientAuth.label')}</Label>
        <Select
          value={current.clientAuth}
          onValueChange={(value) => set('clientAuth', value as OAuth2AuthParams['clientAuth'])}
          disabled={disabled}
        >
          <SelectTrigger id="oauth2-client-auth" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="header">{t('authForms.oauth2AuthForm.sendAsBasicHeader.text')}</SelectItem>
            <SelectItem value="body">{t('authForms.oauth2AuthForm.sendInBody.text')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {t('authForms.oauth2AuthForm.clientAuth.help')}
        </p>
      </div>
    </div>
  );
};
