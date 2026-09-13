import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEnvironments, NO_ENVIRONMENT } from '@/hooks/use-environments';

/**
 * Picks the environment a run resolves against.
 *
 * Without one, `{{baseUrl}}` falls back to the process default and every `{{secret_…}}`
 * fails by name — which is what happened on every screen except the test-plan page, because
 * they had no way to offer the choice.
 */

interface EnvironmentSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}

export const EnvironmentSelect: React.FC<EnvironmentSelectProps> = ({
  value,
  onChange,
  disabled,
  id = 'environment',
  label,
}) => {
  const { t } = useTranslation();
  const { data: environments = [], isLoading } = useEnvironments();

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label ?? t('environmentSelect.label')}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
        <SelectTrigger id={id}>
          <SelectValue
            placeholder={isLoading ? t('environmentSelect.loading') : t('environmentSelect.none')}
          />
        </SelectTrigger>
        <SelectContent>
          {/* Always offered: a run against the defaults is a legitimate choice, and it is
              what every run did before environments were reachable. */}
          <SelectItem value={NO_ENVIRONMENT}>{t('environmentSelect.defaultsOnly')}</SelectItem>
          {environments.map((environment) => (
            <SelectItem key={environment.id} value={String(environment.id)}>
              {environment.name}
              {environment.loginStateCapturedAt ? ` · ${t('environmentSelect.signedIn')}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isLoading && environments.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('environmentSelect.emptyHint')}</p>
      )}
    </div>
  );
};
