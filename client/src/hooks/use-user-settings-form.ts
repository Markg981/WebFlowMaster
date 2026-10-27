import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/queryClient';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { useTheme } from '@/hooks/use-theme';
import { type UserSettings, fetchSettings } from '@/lib/settings';

const saveSettings = async (settings: Partial<UserSettings>): Promise<UserSettings> => {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to save settings');
  }
  return response.json();
};

export type Browser = 'chromium' | 'firefox' | 'webkit';

/**
 * The one user-settings record behind Preferences, Test defaults and Notifications.
 *
 * The three sections edit fields of the same record and save it whole, so they share this
 * state rather than each keeping a copy that the others' save would overwrite.
 */
export function useUserSettingsForm() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // Owned by useTheme, which reads the document rather than a cached copy of the settings.
  const { isDark, setTheme } = useTheme();

  const [emailNotifications, setEmailNotifications] = useState(false);
  const [testCompletionNotifications, setTestCompletionNotifications] = useState(true);
  const [errorNotifications, setErrorNotifications] = useState(true);
  const [defaultUrl, setDefaultUrl] = useState('');
  const [browser, setBrowser] = useState<Browser>('chromium');
  const [headless, setHeadless] = useState(true);
  const [defaultTimeout, setDefaultTimeout] = useState('30000');
  const [waitTime, setWaitTime] = useState('1000');
  const [language, setLanguage] = useState('en');

  const settings = useQuery<UserSettings, Error>({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    // The theme is deliberately not read back here. It is owned by useTheme, which follows
    // the document; taking it from this query is what let a cached "light" — never
    // refetched, because the query client sets staleTime: Infinity — undo a choice the
    // user had just made from the topbar.
    setDefaultUrl(data.defaultTestUrl || '');
    setBrowser(data.playwrightBrowser);
    setHeadless(data.playwrightHeadless);
    setDefaultTimeout(String(data.playwrightDefaultTimeout));
    setWaitTime(String(data.playwrightWaitTime));
    setLanguage(data.language || 'en');
    setEmailNotifications(data.notifyByEmail ?? false);
    setTestCompletionNotifications(data.notifyRunCompleted ?? true);
    setErrorNotifications(data.notifyRunFailed ?? true);
  }, [settings.data]);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language, i18n]);

  const mutation = useMutation<UserSettings, Error, Partial<UserSettings>>({
    mutationFn: saveSettings,
    onSuccess: (savedData) => {
      queryClient.setQueryData(['settings'], savedData);
      toast({
        title: t('settings.toast.savedTitle'),
        description: t('settings.toast.savedDescription'),
      });
    },
    onError: (error) => {
      toast({
        title: t('settings.toast.errorTitle'),
        description: errorMessage(error) || t('settings.toast.errorDescription'),
        variant: 'destructive',
      });
    },
  });

  const save = () => {
    const settingsToSave: Partial<UserSettings> = {
      theme: isDark ? 'dark' : 'light',
      defaultTestUrl: defaultUrl === '' ? null : defaultUrl,
      playwrightBrowser: browser,
      playwrightHeadless: headless,
      playwrightDefaultTimeout: parseInt(defaultTimeout, 10),
      playwrightWaitTime: parseInt(waitTime, 10),
      language: language,
      notifyByEmail: emailNotifications,
      notifyRunCompleted: testCompletionNotifications,
      notifyRunFailed: errorNotifications,
    };
    if (
      isNaN(settingsToSave.playwrightDefaultTimeout!) ||
      settingsToSave.playwrightDefaultTimeout! <= 0
    ) {
      toast({
        title: 'Invalid Timeout',
        description: 'Default timeout must be a positive number.',
        variant: 'destructive',
      });
      return;
    }
    if (isNaN(settingsToSave.playwrightWaitTime!) || settingsToSave.playwrightWaitTime! <= 0) {
      toast({
        title: 'Invalid Wait Time',
        description: 'Wait time must be a positive number.',
        variant: 'destructive',
      });
      return;
    }
    mutation.mutate(settingsToSave);
  };

  const reset = () => {
    setTheme('light');
    setDefaultUrl('');
    setBrowser('chromium');
    setHeadless(true);
    setDefaultTimeout('30000');
    setWaitTime('1000');
    setLanguage('en');
    setEmailNotifications(false);
    setTestCompletionNotifications(true);
    setErrorNotifications(true);
    toast({
      title: t('settings.toast.resetTitle'),
      description: t('settings.toast.resetDescription'),
    });
  };

  return {
    settings,
    isSaving: mutation.isPending,
    save,
    reset,
    isDark,
    setTheme,
    language,
    setLanguage,
    defaultUrl,
    setDefaultUrl,
    browser,
    setBrowser,
    headless,
    setHeadless,
    defaultTimeout,
    setDefaultTimeout,
    waitTime,
    setWaitTime,
    emailNotifications,
    setEmailNotifications,
    testCompletionNotifications,
    setTestCompletionNotifications,
    errorNotifications,
    setErrorNotifications,
  };
}

export type UserSettingsForm = ReturnType<typeof useUserSettingsForm>;
