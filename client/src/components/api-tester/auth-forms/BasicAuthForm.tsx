import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BasicAuthParams } from '@shared/schema';

interface BasicAuthFormProps {
  params: Partial<BasicAuthParams>; // Use Partial if params can be initially empty
  onChange: (newParams: BasicAuthParams) => void;
  disabled?: boolean;
}

export const BasicAuthForm: React.FC<BasicAuthFormProps> = ({
  params,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const handleInputChange = (field: keyof BasicAuthParams, value: string) => {
    onChange({
      username: params.username || '',
      password: params.password || '',
      [field]: value,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="basic-username">{t('authForms.basicAuthForm.username.label')}</Label>
        <Input
          id="basic-username"
          type="text"
          value={params.username || ''}
          onChange={(e) => handleInputChange('username', e.target.value)}
          placeholder={t('authForms.basicAuthForm.enterUsername.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="basic-password">{t('authForms.basicAuthForm.password.label')}</Label>
        <Input
          id="basic-password"
          type="password"
          value={params.password || ''}
          onChange={(e) => handleInputChange('password', e.target.value)}
          placeholder={t('authForms.basicAuthForm.enterPassword.placeholder')}
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
};
