import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BearerTokenAuthParams } from '@shared/schema';

interface BearerTokenAuthFormProps {
  params: Partial<BearerTokenAuthParams>; // Use Partial if params can be initially empty
  onChange: (newParams: BearerTokenAuthParams) => void;
  disabled?: boolean;
}

export const BearerTokenAuthForm: React.FC<BearerTokenAuthFormProps> = ({
  params,
  onChange,
  disabled = false,
}) => {
  const handleInputChange = (value: string) => {
    onChange({
      token: value,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="bearer-token">Token</Label>
        <Input
          id="bearer-token"
          type="password" // Often tokens are sensitive, password type hides it
          value={params.token || ''}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="Enter bearer token"
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
};
