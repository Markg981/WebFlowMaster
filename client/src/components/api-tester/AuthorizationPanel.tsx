import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AuthType,
  AuthParams,
  AuthTypeSchema,
  BasicAuthParams,
  BearerTokenAuthParams,
  ApiKeyAuthParams,
  OAuth2AuthParams,
} from '@shared/schema';
import { AuthTypeDropdown, authTypeDisplayMap } from './AuthTypeDropdown';
import { BasicAuthForm } from './auth-forms/BasicAuthForm';
import { BearerTokenAuthForm } from './auth-forms/BearerTokenAuthForm';
import { ApiKeyAuthForm } from './auth-forms/ApiKeyAuthForm';
import { OAuth2AuthForm } from './auth-forms/OAuth2AuthForm';
import { Label } from '@/components/ui/label';

interface AuthorizationPanelProps {
  authType: AuthType;
  authParams?: AuthParams; // Can be undefined if no auth or no params for selected type
  onAuthTypeChange: (newType: AuthType) => void;
  onAuthParamsChange: (newParams: AuthParams) => void;
  disabled?: boolean;
}

/**
 * What the settings become when the scheme changes.
 *
 * The type and the parameters are two pieces of state, and nothing used to reset the second
 * when the first changed: picking NTLM after filling in a bearer token left the token in
 * place, and since it is the parameters that are sent, the request went out as Bearer while
 * the page said NTLM.
 */
export function emptyAuthParamsFor(type: AuthType): AuthParams {
  switch (type) {
    case 'basic':
      return { type, params: { username: '', password: '' } };
    case 'bearer':
      return { type, params: { token: '' } };
    case 'apiKey':
      return { type, params: { key: '', value: '', addTo: 'header' } };
    case 'oauth2':
      return {
        type,
        params: {
          grantType: 'client_credentials',
          tokenUrl: '',
          clientId: '',
          clientSecret: '',
          scope: '',
          username: '',
          password: '',
          clientAuth: 'header',
        },
      };
    default:
      return { type } as AuthParams;
  }
}


export const AuthorizationPanel: React.FC<AuthorizationPanelProps> = ({
  authType,
  authParams,
  onAuthTypeChange,
  onAuthParamsChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const renderAuthForm = () => {
    switch (authType) {
      case AuthTypeSchema.enum.basic:
        return (
          <BasicAuthForm
            params={(authParams?.type === 'basic' ? authParams.params : {}) as BasicAuthParams}
            onChange={(newParams) =>
              onAuthParamsChange({ type: 'basic', params: newParams })
            }
            disabled={disabled}
          />
        );
      case AuthTypeSchema.enum.bearer:
        return (
          <BearerTokenAuthForm
            params={(authParams?.type === 'bearer' ? authParams.params : {}) as BearerTokenAuthParams}
            onChange={(newParams) =>
              onAuthParamsChange({ type: 'bearer', params: newParams })
            }
            disabled={disabled}
          />
        );
      case AuthTypeSchema.enum.apiKey:
        return (
          <ApiKeyAuthForm
            params={(authParams?.type === 'apiKey' ? authParams.params : {}) as ApiKeyAuthParams}
            onChange={(newParams) =>
              onAuthParamsChange({ type: 'apiKey', params: newParams })
            }
            disabled={disabled}
          />
        );
      case AuthTypeSchema.enum.oauth2:
        return (
          <OAuth2AuthForm
            params={(authParams?.type === 'oauth2' ? authParams.params : {}) as OAuth2AuthParams}
            onChange={(newParams) => onAuthParamsChange({ type: 'oauth2', params: newParams })}
            disabled={disabled}
          />
        );
      case AuthTypeSchema.enum.none:
      case AuthTypeSchema.enum.inherit:
        return <p className="text-sm text-muted-foreground mt-2">No parameters for this auth type.</p>;
      default:
        // Reached only by a saved test that named a scheme nothing implements. Say what will
        // happen when it runs, rather than "not yet configurable", which reads as though the
        // request would still be authenticated somehow.
        return (
          <p className="text-sm text-muted-foreground mt-2" role="note">
            {t('apiTester.authorizationPanel.schemeUnavailable.text', {
              scheme: authTypeDisplayMap[authType] || authType,
            })}
          </p>
        );
    }
  };

  const handleTypeChange = (next: AuthType) => {
    onAuthTypeChange(next);
    // Parameters belong to one scheme; carrying the previous scheme's over would send
    // credentials the panel is no longer showing.
    onAuthParamsChange(emptyAuthParamsFor(next));
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="auth-type-dropdown">{t('apiTester.authorizationPanel.authorizationType.label')}</Label>
        <AuthTypeDropdown
          authType={authType}
          onAuthTypeChange={handleTypeChange}
          disabled={disabled}
        />
      </div>
      <div className="mt-4">
        {renderAuthForm()}
      </div>
    </div>
  );
};
