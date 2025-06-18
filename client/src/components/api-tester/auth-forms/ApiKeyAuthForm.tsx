import React from 'react';
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
        <Label htmlFor="apiKey-key">Key</Label>
        <Input
          id="apiKey-key"
          type="text"
          value={params.key || ''}
          onChange={(e) => handleInputChange('key', e.target.value)}
          placeholder="Enter API key name (e.g., X-API-KEY)"
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="apiKey-value">Value</Label>
        <Input
          id="apiKey-value"
          type="password" // API keys are sensitive
          value={params.value || ''}
          onChange={(e) => handleInputChange('value', e.target.value)}
          placeholder="Enter API key value"
          disabled={disabled}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="apiKey-addTo">Add to</Label>
        <Select
          value={params.addTo || 'header'}
          onValueChange={(value: ApiKeyAuthParams['addTo']) =>
            handleSelectChange(value)
          }
          disabled={disabled}
        >
          <SelectTrigger id="apiKey-addTo" className="w-full mt-1">
            <SelectValue placeholder="Select where to add API key" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="header">Header</SelectItem>
            <SelectItem value="query">Query Param</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
