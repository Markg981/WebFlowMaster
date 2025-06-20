import React from 'react';
import {
  AuthType,
  AuthParams,
  AuthTypeSchema,
  BasicAuthParams,
  BearerTokenAuthParams,
  ApiKeyAuthParams,
} from '@shared/schema';
import { AuthTypeDropdown } from './AuthTypeDropdown';
import { BasicAuthForm } from './auth-forms/BasicAuthForm';
import { BearerTokenAuthForm } from './auth-forms/BearerTokenAuthForm';
import { ApiKeyAuthForm } from './auth-forms/ApiKeyAuthForm';
import { Label } from '@/components/ui/label';

interface AuthorizationPanelProps {
  authType: AuthType;
  authParams?: AuthParams; // Can be undefined if no auth or no params for selected type
  onAuthTypeChange: (newType: AuthType) => void;
  onAuthParamsChange: (newParams: AuthParams) => void;
  disabled?: boolean;
}

const authTypeDisplayMap: Record<AuthType, string> = {
  inherit: 'Inherit from Parent',
  none: 'No Auth',
  basic: 'Basic Auth',
  bearer: 'Bearer Token',
  jwtBearer: 'JWT Bearer',
  digest: 'Digest Auth',
  oauth1: 'OAuth 1.0',
  oauth2: 'OAuth 2.0',
  hawk: 'Hawk Authentication',
  aws: 'AWS Signature',
  ntlm: 'NTLM Authentication',
  apiKey: 'API Key',
  akamai: 'Akamai EdgeGrid',
  asap: 'Atlassian ASAP',
};


export const AuthorizationPanel: React.FC<AuthorizationPanelProps> = ({
  authType,
  authParams,
  onAuthTypeChange,
  onAuthParamsChange,
  disabled = false,
}) => {
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
      case AuthTypeSchema.enum.none:
      case AuthTypeSchema.enum.inherit:
        return <p className="text-sm text-muted-foreground mt-2">No parameters for this auth type.</p>;
      default:
        return (
          <p className="text-sm text-muted-foreground mt-2">
            {authTypeDisplayMap[authType] || authType} parameters are not yet configurable.
          </p>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="auth-type-dropdown">{t('apiTester.authorizationPanel.authorizationType.label')}</Label>
        <AuthTypeDropdown
          authType={authType}
          onAuthTypeChange={onAuthTypeChange}
          disabled={disabled}
        />
      </div>
      <div className="mt-4">
        {renderAuthForm()}
      </div>
    </div>
  );
};
