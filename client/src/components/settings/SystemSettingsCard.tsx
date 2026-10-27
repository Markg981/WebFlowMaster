import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/queryClient';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Loader2, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type SystemSetting = { key: string; value: string };

const fetchSystemSetting = async (key: string): Promise<SystemSetting | null> => {
  const response = await fetch(`/api/system-settings/${key}`);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to fetch system setting: ${key}`);
  }
  return response.json();
};

const saveSystemSetting = async (setting: SystemSetting): Promise<SystemSetting> => {
  const response = await fetch('/api/system-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setting),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to save system setting');
  }
  return response.json();
};

const LOG_LEVELS = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'http', label: 'HTTP' },
  { value: 'verbose', label: 'Verbose' },
  { value: 'debug', label: 'Debug' },
  { value: 'silly', label: 'Silly' },
];

/**
 * Settings → System: log retention and minimum log level, which apply to the whole
 * installation. Its administrators change them; anyone else sees them read-only.
 */
export default function SystemSettingsCard({
  canManageInstallation,
}: {
  canManageInstallation: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [logRetentionDays, setLogRetentionDays] = useState<string>('7');
  const [logLevel, setLogLevel] = useState<string>('info');

  const {
    data: logRetentionSettingData,
    isLoading: isLoadingLogRetentionSetting,
    isError: isErrorLogRetentionSetting,
    error: logRetentionSettingError,
  } = useQuery<SystemSetting | null, Error>({
    queryKey: ['systemSetting', 'logRetentionDays'],
    queryFn: () => fetchSystemSetting('logRetentionDays'),
  });

  const {
    data: logLevelSettingData,
    isLoading: isLoadingLogLevelSetting,
    isError: isErrorLogLevelSetting,
    error: logLevelSettingError,
  } = useQuery<SystemSetting | null, Error>({
    queryKey: ['systemSetting', 'logLevel'],
    queryFn: () => fetchSystemSetting('logLevel'),
  });

  useEffect(() => {
    if (logRetentionSettingData && logRetentionSettingData.value) {
      setLogRetentionDays(logRetentionSettingData.value);
    } else if (!isLoadingLogRetentionSetting && logRetentionSettingData === null) {
      // Default if not set in DB
      setLogRetentionDays('7');
    }
  }, [logRetentionSettingData, isLoadingLogRetentionSetting]);

  useEffect(() => {
    if (logLevelSettingData && logLevelSettingData.value) {
      setLogLevel(logLevelSettingData.value);
    } else if (!isLoadingLogLevelSetting && logLevelSettingData === null) {
      setLogLevel('info');
    }
  }, [logLevelSettingData, isLoadingLogLevelSetting]);

  const saveLogRetentionMutation = useMutation<SystemSetting, Error, SystemSetting>({
    mutationFn: saveSystemSetting,
    onSuccess: (savedSetting) => {
      queryClient.setQueryData(['systemSetting', savedSetting.key], savedSetting);
      toast({
        title: t('settings.system.toast.logRetentionSavedTitle', 'Log Retention Saved'),
        description: t(
          'settings.system.toast.logRetentionSavedDescription',
          'Log retention period set to {{days}} days.',
          { days: savedSetting.value },
        ),
      });
    },
    onError: (error) => {
      toast({
        title: t('settings.system.toast.logRetentionErrorTitle', 'Error Saving Log Retention'),
        description: errorMessage(error) || t('settings.toast.errorDescription'),
        variant: 'destructive',
      });
    },
  });

  const saveLogLevelMutation = useMutation<SystemSetting, Error, SystemSetting>({
    mutationFn: saveSystemSetting,
    onSuccess: (savedSetting) => {
      queryClient.setQueryData(['systemSetting', savedSetting.key], savedSetting);
      setLogLevel(savedSetting.value);
      toast({
        title: t('settings.system.toast.logLevelSavedTitle', 'Log Level Saved'),
        description: t(
          'settings.system.toast.logLevelSavedDescription',
          'Minimum log level set to {{level}}.',
          { level: savedSetting.value },
        ),
      });
    },
    onError: (error) => {
      toast({
        title: t('settings.system.toast.logLevelErrorTitle', 'Error Saving Log Level'),
        description: errorMessage(error) || t('settings.toast.errorDescription'),
        variant: 'destructive',
      });
    },
  });

  const handleSaveLogRetentionSetting = () => {
    const days = parseInt(logRetentionDays, 10);
    if (isNaN(days) || days <= 0) {
      toast({
        title: t('settings.system.validation.invalidDaysTitle', 'Invalid Input'),
        description: t(
          'settings.system.validation.positiveNumberError',
          'Log retention period must be a positive number.',
        ),
        variant: 'destructive',
      });
      return;
    }
    saveLogRetentionMutation.mutate({ key: 'logRetentionDays', value: logRetentionDays });
  };

  const handleSaveLogLevelSetting = () => {
    if (!LOG_LEVELS.find((l) => l.value === logLevel)) {
      toast({
        title: t('settings.system.validation.invalidLogLevelTitle', 'Invalid Log Level'),
        description: t(
          'settings.system.validation.selectValidLogLevelError',
          'Please select a valid log level.',
        ),
        variant: 'destructive',
      });
      return;
    }
    saveLogLevelMutation.mutate({ key: 'logLevel', value: logLevel });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.system.title', 'System Settings')}</span>
        </CardTitle>
        <CardDescription>
          {t('settings.system.description', 'Manage system-wide configurations.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManageInstallation && (
          <p className="text-sm text-muted-foreground" data-testid="system-read-only">
            {t(
              'settings.system.readOnly',
              'These settings apply to every organization on this installation, so they are changed by its administrators.',
            )}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="logRetentionDays">
            {t('settings.system.logRetentionLabel', 'Log Retention Period (days)')}
          </Label>
          <Input
            id="logRetentionDays"
            type="number"
            value={logRetentionDays}
            onChange={(e) => setLogRetentionDays(e.target.value)}
            disabled={
              !canManageInstallation ||
              isLoadingLogRetentionSetting ||
              saveLogRetentionMutation.isPending
            }
            min="1"
          />
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.system.logRetentionDescription',
              'Number of days to keep server logs. Older logs are compressed and then deleted.',
            )}
          </p>
          {isErrorLogRetentionSetting && (
            <p className="text-sm text-destructive">
              {logRetentionSettingError?.message ||
                t('settings.system.fetchError', 'Failed to fetch log retention setting.')}
            </p>
          )}
        </div>
        <Button
          onClick={handleSaveLogRetentionSetting}
          disabled={
            !canManageInstallation ||
            isLoadingLogRetentionSetting ||
            saveLogRetentionMutation.isPending ||
            (logRetentionSettingData?.value === logRetentionDays &&
              logRetentionSettingData !== null &&
              !isErrorLogRetentionSetting)
          }
        >
          {saveLogRetentionMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saveLogRetentionMutation.isPending
            ? t('settings.buttons.saving', 'Saving...')
            : t('settings.system.saveButton', 'Save Log Retention')}
        </Button>
        <Separator />
        <div className="space-y-2">
          <Label htmlFor="logLevelSelect">
            {t('settings.system.logLevelLabel', 'Minimum Log Level')}
          </Label>
          <Select
            value={logLevel}
            onValueChange={setLogLevel}
            disabled={
              !canManageInstallation || isLoadingLogLevelSetting || saveLogLevelMutation.isPending
            }
          >
            <SelectTrigger id="logLevelSelect">
              <SelectValue
                placeholder={t('settings.system.logLevelPlaceholder', 'Select log level...')}
              />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  {level.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.system.logLevelDescription',
              'Select the minimum level of logs to record. Dynamic update is attempted, otherwise requires application restart.',
            )}
          </p>
          {isErrorLogLevelSetting && (
            <p className="text-sm text-destructive">
              {logLevelSettingError?.message ||
                t('settings.system.fetchErrorLogLevel', 'Failed to fetch log level setting.')}
            </p>
          )}
        </div>
        <Button
          onClick={handleSaveLogLevelSetting}
          disabled={
            !canManageInstallation ||
            isLoadingLogLevelSetting ||
            saveLogLevelMutation.isPending ||
            (logLevelSettingData?.value === logLevel &&
              logLevelSettingData !== null &&
              !isErrorLogLevelSetting)
          }
        >
          {saveLogLevelMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saveLogLevelMutation.isPending
            ? t('settings.buttons.saving', 'Saving...')
            : t('settings.system.saveButtonLogLevel', 'Save Log Level')}
        </Button>
      </CardContent>
    </Card>
  );
}
