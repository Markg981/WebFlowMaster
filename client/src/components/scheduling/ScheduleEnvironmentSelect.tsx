import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NO_ENVIRONMENT, useEnvironments } from '@/hooks/use-environments';

/**
 * The environment a schedule runs against, chosen from the organization's own environments.
 *
 * The schedule forms offered a fixed list — QA, Staging, Production, Development — or a free text
 * box, and saved the name. Nothing connected that name to an environment: a scheduled run went
 * out with no environment's variables and no saved login, whatever the schedule said. The value
 * saved now is the environment's id, which is what the scheduler resolves.
 *
 * A schedule saved before this holds a name. One that matches an environment of this
 * organization is shown as that environment and saved as its id the next time the form is saved;
 * one that matches nothing is shown as what it is — a name that loads nothing — rather than
 * silently replaced.
 */
export default function ScheduleEnvironmentSelect({
  id = 'environment',
  value,
  onChange,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { data: environments = [], isLoading } = useEnvironments();
  const current = value ?? '';

  const byId = environments.find((env) => String(env.id) === current);
  const byName = byId ? undefined : environments.find((env) => env.name === current);

  // A legacy name that is an environment's name becomes that environment's id.
  useEffect(() => {
    if (byName) onChange(String(byName.id));
  }, [byName, onChange]);

  const unknownLegacyName = current && !byId && !byName && !isLoading ? current : null;

  return (
    <Select
      value={current === '' ? NO_ENVIRONMENT : String(byName?.id ?? current)}
      onValueChange={(selected) => onChange(selected === NO_ENVIRONMENT ? '' : selected)}
      disabled={isLoading}
    >
      <SelectTrigger id={id} aria-label={t('scheduleEnvironment.label', 'Environment')}>
        <SelectValue placeholder={t('scheduleEnvironment.placeholder', 'Choose an environment')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ENVIRONMENT}>{t('scheduleEnvironment.none', 'No environment (defaults only)')}</SelectItem>
        {environments.map((env) => (
          <SelectItem key={env.id} value={String(env.id)}>
            {env.name}
          </SelectItem>
        ))}
        {unknownLegacyName && (
          <SelectItem value={unknownLegacyName}>
            {t('scheduleEnvironment.unknown', '{{name}} — not an environment of this organization; nothing is loaded', { name: unknownLegacyName })}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
