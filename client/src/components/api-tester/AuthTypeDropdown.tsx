import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AuthType, AuthTypeSchema } from '@shared/schema';

interface AuthTypeDropdownProps {
  authType: AuthType;
  onAuthTypeChange: (newType: AuthType) => void;
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
        {AuthTypeSchema.options.map((type) => (
          <SelectItem key={type} value={type}>
            {authTypeDisplayMap[type] || type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
