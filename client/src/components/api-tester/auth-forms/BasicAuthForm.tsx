import React from 'react';
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
        <Label htmlFor="basic-username">Username</Label>
        <Input
          id="basic-username"
          type="text"
          value={params.username || ''}
          onChange={(e) => handleInputChange('username', e.target.value)}
          placeholder="Enter username"
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="basic-password">Password</Label>
        <Input
          id="basic-password"
          type="password"
          value={params.password || ''}
          onChange={(e) => handleInputChange('password', e.target.value)}
          placeholder="Enter password"
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
};
