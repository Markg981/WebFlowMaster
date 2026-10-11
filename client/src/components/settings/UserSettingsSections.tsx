import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell, Globe, Loader2, Monitor, Moon, Save, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Browser, UserSettingsForm } from '@/hooks/use-user-settings-form';

/**
 * The sections of Settings that edit the signed-in user's own record (see
 * useUserSettingsForm): Preferences, Test defaults and Notifications.
 */
type Props = { form: UserSettingsForm; disabled: boolean };

/**
 * The save bar belongs to the two sections whose fields it writes.
 *
 * It sends the whole user-settings record — theme, language, default URL, browser,
 * headless, timeouts — so it is the same bar in both places rather than two that disagree.
 * Projects, environments and the log settings each save themselves where they are, and
 * showing an unrelated "Save" under them only invited the question of what it would save.
 */
export function UserSettingsFooter({ form, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
      <Button variant="outline" onClick={form.reset} disabled={disabled}>
        {t('settings.buttons.resetForm')}
      </Button>
      <div className="flex space-x-3">
        <Link href="/">
          <Button variant="ghost" disabled={disabled}>
            {t('settings.buttons.cancel')}
          </Button>
        </Link>
        <Button onClick={form.save} disabled={disabled}>
          {form.isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {form.isSaving
            ? t('settings.buttons.saving')
            : t('settings.buttons.saveUserSettings', 'Save User Settings')}
        </Button>
      </div>
    </div>
  );
}

export function PreferencesCards({ form, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Sun className="h-4 w-4 text-muted-foreground" />
            <span>{t('settings.appearance.title')}</span>
          </CardTitle>
          <CardDescription>{t('settings.appearance.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="settings-dark-mode" className="text-sm font-medium">
                {t('settings.appearance.darkModeLabel')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.appearance.darkModeDescription')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Sun className="h-4 w-4" aria-hidden="true" />
              <Switch
                id="settings-dark-mode"
                checked={form.isDark}
                onCheckedChange={(on) => form.setTheme(on ? 'dark' : 'light')}
                disabled={disabled}
              />
              <Moon className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span>{t('settings.languageSettings.title')}</span>
          </CardTitle>
          <CardDescription>{t('settings.languageSettings.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="language-select">{t('settings.languageSettings.selectLabel')}</Label>
            <Select value={form.language} onValueChange={form.setLanguage} disabled={disabled}>
              <SelectTrigger id="language-select">
                <SelectValue placeholder={t('settings.languageSettings.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t('settings.languageSettings.english')}</SelectItem>
                <SelectItem value="it">{t('settings.languageSettings.italian')}</SelectItem>
                <SelectItem value="fr">{t('settings.languageSettings.french')}</SelectItem>
                <SelectItem value="de">{t('settings.languageSettings.german')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t('settings.languageSettings.selectHint')}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export function TestDefaultsCards({ form, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span>{t('settings.defaults.title', 'Default Configuration')}</span>
          </CardTitle>
          <CardDescription>
            {t('settings.defaults.description', 'Set default values for test creation')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="defaultUrl">
              {t('settings.defaults.defaultUrlLabel', 'Default URL for Test Creation')}
            </Label>
            <Input
              id="defaultUrl"
              type="url"
              placeholder="https://example.com"
              value={form.defaultUrl}
              onChange={(e) => form.setDefaultUrl(e.target.value)}
              disabled={disabled}
            />
            <p className="text-sm text-muted-foreground">
              {t(
                'settings.defaults.defaultUrlDescription',
                'This URL will be pre-filled when creating new tests',
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span>{t('settings.playwright.title')}</span>
          </CardTitle>
          <CardDescription>{t('settings.playwright.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="browser">{t('settings.playwright.browserLabel')}</Label>
              <Select
                value={form.browser}
                onValueChange={(value: Browser) => form.setBrowser(value)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('settings.playwright.browserPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">{t('settingsPage.chromium.text')}</SelectItem>
                  <SelectItem value="firefox">{t('settingsPage.firefox.text')}</SelectItem>
                  <SelectItem value="webkit">{t('settingsPage.webkitSafari.text')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeout">{t('settings.playwright.timeoutLabel')}</Label>
              <Input
                id="timeout"
                type="number"
                value={form.defaultTimeout}
                onChange={(e) => form.setDefaultTimeout(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between pt-2">
              <div>
                <Label htmlFor="settings-headless" className="text-sm font-medium">
                  {t('settings.playwright.headlessLabel')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.playwright.headlessDescription')}
                </p>
              </div>
              <Switch
                id="settings-headless"
                checked={form.headless}
                onCheckedChange={form.setHeadless}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waitTime">{t('settings.playwright.waitLabel')}</Label>
              <Input
                id="waitTime"
                type="number"
                value={form.waitTime}
                onChange={(e) => form.setWaitTime(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export function NotificationsCard({ form, disabled }: Props) {
  const { t } = useTranslation();
  // Whether this installation sends e-mail at all (SMTP_URL), to say so next to the switches.
  const { data: mailStatus } = useQuery<{ available: boolean }>({
    queryKey: ['mailAvailable'],
    queryFn: async () => (await fetch('/api/password-reset/available')).json(),
  });
  const toggles: Array<{
    label: string;
    description: string;
    checked: boolean;
    onChange: (on: boolean) => void;
  }> = [
    {
      label: t('settings.notifications.testCompletionLabel', 'Test Completion'),
      description: t(
        'settings.notifications.testCompletionDescription',
        'Notify when tests finish running',
      ),
      checked: form.testCompletionNotifications,
      onChange: form.setTestCompletionNotifications,
    },
    {
      label: t('settings.notifications.errorAlertsLabel', 'Error Alerts'),
      description: t(
        'settings.notifications.errorAlertsDescription',
        'Get notified about test failures',
      ),
      checked: form.errorNotifications,
      onChange: form.setErrorNotifications,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.notifications.title', 'Notifications')}</span>
        </CardTitle>
        <CardDescription>
          {t(
            'settings.notifications.description',
            "E-mail about the runs you start, sent to the address you sign in with. A plan's own notifications are set on the plan.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="settings-email-notifications" className="text-sm font-medium">
              {t('settings.notifications.emailLabel', 'Email Notifications')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('settings.notifications.emailDescription', 'Receive updates via email')}
            </p>
          </div>
          <Switch
            id="settings-email-notifications"
            checked={form.emailNotifications}
            onCheckedChange={form.setEmailNotifications}
            disabled={disabled}
          />
        </div>
        <Separator />
        {toggles.map((toggle) => (
          <div key={toggle.label} className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">{toggle.label}</Label>
              <p className="text-sm text-muted-foreground">{toggle.description}</p>
            </div>
            <Switch
              checked={toggle.checked}
              onCheckedChange={toggle.onChange}
              disabled={disabled}
            />
          </div>
        ))}
        {mailStatus && !mailStatus.available && (
          <p className="text-sm text-muted-foreground" data-testid="mail-not-configured">
            {t(
              'settings.notifications.notConfigured',
              'This installation does not send e-mail yet (an administrator sets SMTP_URL); your choices are kept for when it does.',
            )}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={form.save} disabled={disabled}>
            {t('settings.notifications.save', 'Save notifications')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
