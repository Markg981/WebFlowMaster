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
import { ApiKeyAuthParams } from '@shared/schema';

interface ApiKeyAuthFormProps {
  params: Partial<ApiKeyAuthParams>;
  onChange: (newParams: ApiKeyAuthParams) => void;
  disabled?: boolean;
}

export const ApiKeyAuthForm: React.FC<ApiKeyAuthFormProps> = ({
  params,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const handleInputChange = (
    field: keyof Omit<ApiKeyAuthParams, 'addTo'>,
    value: string
  ) => {
    onChange({
      key: params.key || '',
      value: params.value || '',
      addTo: params.addTo || 'header', // Default to header if not set
      [field]: value,
    });
  };

  const handleSelectChange = (value: ApiKeyAuthParams['addTo']) => {
    onChange({
      key: params.key || '',
      value: params.value || '',
      addTo: value,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="apiKey-key">{t('authForms.apiKeyAuthForm.key.label')}</Label>
        <Input
          id="apiKey-key"
          type="text"
          value={params.key || ''}
          onChange={(e) => handleInputChange('key', e.target.value)}
          placeholder={t('authForms.apiKeyAuthForm.enterApiKeyNameEgXapikey.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="apiKey-value">{t('authForms.apiKeyAuthForm.value.label')}</Label>
        <Input
          id="apiKey-value"
          type="password" // API keys are sensitive
          value={params.value || ''}
          onChange={(e) => handleInputChange('value', e.target.value)}
          placeholder={t('authForms.apiKeyAuthForm.enterApiKeyValue.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="apiKey-addTo">{t('authForms.apiKeyAuthForm.addTo.label')}</Label>
        <Select
          value={params.addTo || 'header'}
          onValueChange={(value: ApiKeyAuthParams['addTo']) =>
            handleSelectChange(value)
          }
          disabled={disabled}
        >
          <SelectTrigger id="apiKey-addTo" className="w-full mt-1">
            <SelectValue placeholder={t('authForms.apiKeyAuthForm.selectWhereToAddApiKey.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="header">{t('authForms.apiKeyAuthForm.header.text')}</SelectItem>
            <SelectItem value="query">{t('authForms.apiKeyAuthForm.queryParam.text')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
