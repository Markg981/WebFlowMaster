import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AuthType, AuthTypeSchema, isImplementedAuthType } from '@shared/schema';

interface AuthTypeDropdownProps {
  authType: AuthType;
  onAuthTypeChange: (newType: AuthType) => void;
  disabled?: boolean;
}

/**
 * Exported because the panel beside this one needs the same names, and kept its own copy
 * until they were a rename apart from disagreeing.
 */
export const authTypeDisplayMap: Record<AuthType, string> = {
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

export const AuthTypeDropdown: React.FC<AuthTypeDropdownProps> = ({
  authType,
  onAuthTypeChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  return (
    <Select
      value={authType}
      onValueChange={(value: AuthType) => onAuthTypeChange(value)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t('apiTester.authTypeDropdown.selectAuthType.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {AuthTypeSchema.options.map((type) => {
          const implemented = isImplementedAuthType(type);
          return (
            <SelectItem
              key={type}
              value={type}
              // Eight of these have never done anything: choosing one sent the request with
              // no credentials at all. Saying so in the list is the only place the tester
              // can learn it before spending time on a test that could not have worked.
              // Still rendered, so a saved test that names one can be opened and changed.
              disabled={!implemented && type !== authType}
            >
              {authTypeDisplayMap[type] || type}
              {!implemented && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('apiTester.authTypeDropdown.notAvailable.suffix')}
                </span>
              )}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
