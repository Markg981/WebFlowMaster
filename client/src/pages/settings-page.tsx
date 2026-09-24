import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLayout, type SettingsSection } from '@/components/layout/SettingsLayout';
import { useTheme } from '@/hooks/use-theme';
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from 'react-i18next';
import { 
  Moon,
  Sun,
  Globe, 
  Monitor,
  Bell,
  User,
  Save,
  Loader2,
  ListTree,
  Trash2,
  PlusCircle,
  Archive,
  KeyRound,
  KeySquare,
  Gauge,
  Crosshair,
  Bug,
  SlidersHorizontal,
  ScrollText,
  ShieldCheck,
  Server,
  Lock,
  Users,
  Laptop,
  GitCommitHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import ProjectAccessDialog from "@/components/settings/ProjectAccessDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { UserSettings, fetchSettings } from "../lib/settings";
import EnvironmentsCard from "@/components/settings/EnvironmentsCard";
import ApiKeysCard from "@/components/settings/ApiKeysCard";
import ServiceAccountsCard from "@/components/settings/ServiceAccountsCard";
import MembersCard from "@/components/settings/MembersCard";
import ChangePasswordCard from "@/components/settings/ChangePasswordCard";
import AgentsCard from "@/components/settings/AgentsCard";
import SourceHostsCard from "@/components/settings/SourceHostsCard";
import RunUsageCard from "@/components/settings/RunUsageCard";
import AuditLogCard from "@/components/settings/AuditLogCard";
import SecurityCard from "@/components/settings/SecurityCard";
import SsoCard from "@/components/settings/SsoCard";
import RunnersCard from "@/components/settings/RunnersCard";
import ElementRepositoryCard from "@/components/settings/ElementRepositoryCard";
import IssueTrackersCard from "@/components/settings/IssueTrackersCard";

interface Project {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
  /** Visible only to owners and the project's members. */
  restricted?: boolean;
  /** What the signed-in user may do in it. */
  access?: 'viewer' | 'editor' | 'owner' | null;
}

const saveSettings = async (settings: Partial<UserSettings>): Promise<UserSettings> => {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to save settings");
  }
  return response.json();
};

const fetchProjects = async (): Promise<Project[]> => {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to fetch projects");
  }
  return response.json();
};

const createProject = async (projectName: string): Promise<Project> => {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: projectName }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to create project");
  }
  return response.json();
};

const deleteProject = async (projectId: number): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 204) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to delete project");
  }
  if (response.status === 204) return;
  if (response.ok) return response.json();
};

const fetchSystemSetting = async (key: string): Promise<{ key: string, value: string } | null> => {
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

const saveSystemSetting = async (setting: { key: string, value: string }): Promise<{ key: string, value: string }> => {
  const response = await fetch("/api/system-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setting),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to save system setting");
  }
  return response.json();
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, logoutMutation } = useAuth();
  // Installation-wide settings (log level and retention, runners) belong to the installation's
  // administrators (server/installation-admin.ts). Unknown, from an older server, means yes.
  const canManageInstallation = user?.installationAdmin ?? true;
  const queryClient = useQueryClient();

  const [newProjectName, setNewProjectName] = useState("");
  /** The project whose access dialog is open, for owners. */
  const [accessProjectId, setAccessProjectId] = useState<number | null>(null);
  const [logRetentionDays, setLogRetentionDays] = useState<string>("7");
  const [logLevel, setLogLevel] = useState<string>("info"); // New state for log level

  // State for delete project confirmation dialog
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);
  const [deletingProjectName, setDeletingProjectName] = useState<string | null>(null);

  // Log level options
  const logLevels = [
    { value: 'error', label: 'Error' },
    { value: 'warn', label: 'Warning' },
    { value: 'info', label: 'Info' },
    { value: 'http', label: 'HTTP' },
    { value: 'verbose', label: 'Verbose' },
    { value: 'debug', label: 'Debug' },
    { value: 'silly', label: 'Silly' },
  ];

  const { data: projectsData, isLoading: isLoadingProjects, isError: isErrorProjects, error: projectsError } = useQuery<Project[], Error>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const createProjectMutation = useMutation<Project, Error, string>({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project Created", description: "The new project has been created successfully." });
      setNewProjectName("");
    },
    onError: (error) => {
      toast({ title: "Error Creating Project", description: error.message, variant: "destructive" });
    },
  });

  const deleteProjectMutation = useMutation<void, Error, number>({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project Deleted", description: "The project has been deleted successfully." });
    },
    onError: (error) => {
      toast({ title: "Error Deleting Project", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProject = () => {
    if (newProjectName.trim() === "") {
      toast({ title: "Project name cannot be empty", variant: "destructive" });
      return;
    }
    createProjectMutation.mutate(newProjectName.trim());
  };

  const handleDeleteProject = (project: Project) => { // Accept full project object
    setDeletingProjectId(project.id);
    setDeletingProjectName(project.name);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDeleteProject = () => {
    if (deletingProjectId !== null) {
      deleteProjectMutation.mutate(deletingProjectId);
    }
    setIsDeleteConfirmOpen(false); // Close dialog after action
    setDeletingProjectId(null);
    setDeletingProjectName(null);
  };

  // Owned by useTheme, which reads the document rather than a cached copy of the settings.
  const { isDark, setTheme } = useTheme();
  const [defaultUrl, setDefaultUrl] = useState("");
  const [browser, setBrowser] = useState<"chromium" | "firefox" | "webkit">("chromium");
  const [headless, setHeadless] = useState(true);
  const [defaultTimeout, setDefaultTimeout] = useState("30000");
  const [waitTime, setWaitTime] = useState("1000");
  const [language, setLanguage] = useState("en");

  const { data: settingsData, isLoading: isLoadingSettings, isError: isErrorSettings, error: settingsError } = useQuery<UserSettings, Error>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const { data: logRetentionSettingData, isLoading: isLoadingLogRetentionSetting, isError: isErrorLogRetentionSetting, error: logRetentionSettingError } = useQuery<{ key: string; value: string } | null, Error>({
    queryKey: ["systemSetting", "logRetentionDays"],
    queryFn: () => fetchSystemSetting("logRetentionDays"),
  });

  const { data: logLevelSettingData, isLoading: isLoadingLogLevelSetting, isError: isErrorLogLevelSetting, error: logLevelSettingError } = useQuery<{ key: string; value: string } | null, Error>({
    queryKey: ["systemSetting", "logLevel"],
    queryFn: () => fetchSystemSetting("logLevel"),
  });

  useEffect(() => {
    if (settingsData) {
      // The theme is deliberately not read back here. It is owned by useTheme, which follows
      // the document; taking it from this query is what let a cached "light" — never
      // refetched, because the query client sets staleTime: Infinity — undo a choice the
      // user had just made from the topbar.
      setDefaultUrl(settingsData.defaultTestUrl || "");
      setBrowser(settingsData.playwrightBrowser);
      setHeadless(settingsData.playwrightHeadless);
      setDefaultTimeout(String(settingsData.playwrightDefaultTimeout));
      setWaitTime(String(settingsData.playwrightWaitTime));
      setLanguage(settingsData.language || "en");
    }
  }, [settingsData]);

  useEffect(() => {
    if (logRetentionSettingData && logRetentionSettingData.value) {
      setLogRetentionDays(logRetentionSettingData.value);
    } else if (!isLoadingLogRetentionSetting && logRetentionSettingData === null) {
      // Default if not set in DB
      setLogRetentionDays("7");
    }
  }, [logRetentionSettingData, isLoadingLogRetentionSetting]);

  useEffect(() => {
    if (logLevelSettingData && logLevelSettingData.value) {
      setLogLevel(logLevelSettingData.value);
    } else if (!isLoadingLogLevelSetting && logLevelSettingData === null) {
      // If not set in DB, default to 'info' or a sensible default from the logLevels array
      setLogLevel("info");
    }
  }, [logLevelSettingData, isLoadingLogLevelSetting]);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language, i18n]);

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [testCompletionNotifications, setTestCompletionNotifications] = useState(true);
  const [errorNotifications, setErrorNotifications] = useState(true);

  const userSettingsMutation = useMutation<UserSettings, Error, Partial<UserSettings>>({
    mutationFn: saveSettings,
    onSuccess: (savedData) => {
      queryClient.setQueryData(["settings"], savedData);
      toast({ title: t('settings.toast.savedTitle'), description: t('settings.toast.savedDescription') });
    },
    onError: (error) => {
      toast({ title: t('settings.toast.errorTitle'), description: error.message || t('settings.toast.errorDescription'), variant: "destructive" });
    },
  });

  const saveLogRetentionMutation = useMutation<{ key: string; value: string }, Error, { key: string; value: string }>({
    mutationFn: saveSystemSetting,
    onSuccess: (savedSetting) => {
      queryClient.setQueryData(["systemSetting", savedSetting.key], savedSetting);
      toast({ title: t('settings.system.toast.logRetentionSavedTitle', 'Log Retention Saved'), description: t('settings.system.toast.logRetentionSavedDescription', 'Log retention period set to {{days}} days.', { days: savedSetting.value }) });
    },
    onError: (error) => {
      toast({ title: t('settings.system.toast.logRetentionErrorTitle', 'Error Saving Log Retention'), description: error.message || t('settings.toast.errorDescription'), variant: "destructive" });
    },
  });

  const handleSaveLogRetentionSetting = () => {
    const days = parseInt(logRetentionDays, 10);
    if (isNaN(days) || days <= 0) {
      toast({ title: t('settings.system.validation.invalidDaysTitle', 'Invalid Input'), description: t('settings.system.validation.positiveNumberError', 'Log retention period must be a positive number.'), variant: "destructive" });
      return;
    }
    saveLogRetentionMutation.mutate({ key: "logRetentionDays", value: logRetentionDays });
  };

  const saveLogLevelMutation = useMutation<{ key: string; value: string }, Error, { key: string; value: string }>({
    mutationFn: saveSystemSetting,
    onSuccess: (savedSetting) => {
      queryClient.setQueryData(["systemSetting", savedSetting.key], savedSetting);
      // Update the local state as well
      setLogLevel(savedSetting.value);
      toast({ title: t('settings.system.toast.logLevelSavedTitle', 'Log Level Saved'), description: t('settings.system.toast.logLevelSavedDescription', 'Minimum log level set to {{level}}.', { level: savedSetting.value }) });
    },
    onError: (error) => {
      toast({ title: t('settings.system.toast.logLevelErrorTitle', 'Error Saving Log Level'), description: error.message || t('settings.toast.errorDescription'), variant: "destructive" });
    },
  });

  const handleSaveLogLevelSetting = () => {
    if (!logLevels.find(l => l.value === logLevel)) {
        toast({ title: t('settings.system.validation.invalidLogLevelTitle', 'Invalid Log Level'), description: t('settings.system.validation.selectValidLogLevelError', 'Please select a valid log level.'), variant: "destructive" });
        return;
    }
    saveLogLevelMutation.mutate({ key: "logLevel", value: logLevel });
  };

  const handleSaveUserSettings = () => {
    const settingsToSave: Partial<UserSettings> = {
      theme: isDark ? "dark" : "light",
      defaultTestUrl: defaultUrl === "" ? null : defaultUrl,
      playwrightBrowser: browser,
      playwrightHeadless: headless,
      playwrightDefaultTimeout: parseInt(defaultTimeout, 10),
      playwrightWaitTime: parseInt(waitTime, 10),
      language: language,
    };
    if (isNaN(settingsToSave.playwrightDefaultTimeout!) || settingsToSave.playwrightDefaultTimeout! <= 0) {
      toast({ title: "Invalid Timeout", description: "Default timeout must be a positive number.", variant: "destructive" });
      return;
    }
    if (isNaN(settingsToSave.playwrightWaitTime!) || settingsToSave.playwrightWaitTime! <= 0) {
      toast({ title: "Invalid Wait Time", description: "Wait time must be a positive number.", variant: "destructive" });
      return;
    }
    userSettingsMutation.mutate(settingsToSave);
  };

  const handleResetSettings = () => {
    setTheme("light");
    setDefaultUrl("");
    setBrowser("chromium");
    setHeadless(true);
    setDefaultTimeout("30000");
    setWaitTime("1000");
    setLanguage("en");
    setEmailNotifications(true);
    setTestCompletionNotifications(true);
    setErrorNotifications(true);
    setLogRetentionDays("7"); // Reset log retention to default as well
    toast({ title: t('settings.toast.resetTitle'), description: t('settings.toast.resetDescription') });
  };

  const isAnyLoading = isLoadingSettings || isLoadingLogRetentionSetting || isLoadingLogLevelSetting;
  const isAnyMutating = userSettingsMutation.isPending || saveLogRetentionMutation.isPending || saveLogLevelMutation.isPending || logoutMutation.isPending;
  const isPageDisabled = isAnyLoading || isAnyMutating;

  if (isLoadingSettings || isLoadingLogLevelSetting) { // Initial page load, consider all critical settings fetches
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">{t('settingsPage.loadingSettings.text')}</p>
      </div>
    );
  }

  if (isErrorSettings) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <Bell className="h-10 w-10 text-destructive" />
        <p className="mt-4 text-lg font-semibold text-destructive">{t('settingsPage.errorLoadingUserSettings.label')}</p>
        <p className="text-sm text-muted-foreground">{settingsError?.message || t('settingsPage.anUnknownErrorOccurred.description')}</p>
        <Button onClick={() => queryClient.refetchQueries({ queryKey: ['settings'] })} className="mt-4">
          {t('settingsPage.tryAgain.button')}
        </Button>
      </div>
    );
  }

  /**
   * The save bar belongs to the two sections whose fields it writes.
   *
   * It sends the whole user-settings record — theme, language, default URL, browser,
   * headless, timeouts — so it is the same bar in both places rather than two that disagree.
   * Projects, environments and the log settings each save themselves where they are, and
   * showing an unrelated "Save" under them only invited the question of what it would save.
   */
  const userSettingsFooter = (
    <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
      <Button variant="outline" onClick={handleResetSettings} disabled={isPageDisabled}>{t('settings.buttons.resetForm')}</Button>
      <div className="flex space-x-3">
        <Link href="/"><Button variant="ghost" disabled={isPageDisabled}>{t('settings.buttons.cancel')}</Button></Link>
        <Button onClick={handleSaveUserSettings} disabled={isPageDisabled}>
          {userSettingsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {userSettingsMutation.isPending ? t('settings.buttons.saving') : t('settings.buttons.saveUserSettings', 'Save User Settings')}
        </Button>
      </div>
    </div>
  );

  const sections: SettingsSection[] = [
    {
      id: 'preferences',
      label: t('settings.sections.preferences'),
      description: t('settings.sections.preferencesDescription'),
      icon: Sun,
      footer: userSettingsFooter,
      content: (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Sun className="h-4 w-4 text-muted-foreground" /><span>{t('settings.appearance.title')}</span></CardTitle>
            <CardDescription>{t('settings.appearance.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{t('settings.appearance.darkModeLabel')}</Label>
                <p className="text-sm text-muted-foreground">{t('settings.appearance.darkModeDescription')}</p>
              </div>
              <div className="flex items-center space-x-2">
                <Sun className="h-4 w-4" /><Switch checked={isDark} onCheckedChange={(on) => setTheme(on ? "dark" : "light")} disabled={isPageDisabled} /><Moon className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Globe className="h-4 w-4 text-muted-foreground" /><span>{t('settings.languageSettings.title')}</span></CardTitle>
            <CardDescription>{t('settings.languageSettings.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="language-select">{t('settings.languageSettings.selectLabel')}</Label>
              <Select value={language} onValueChange={(value: string) => setLanguage(value)} disabled={isPageDisabled}>
                <SelectTrigger id="language-select"><SelectValue placeholder={t('settings.languageSettings.selectPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('settings.languageSettings.english')}</SelectItem>
                  <SelectItem value="it">{t('settings.languageSettings.italian')}</SelectItem>
                  <SelectItem value="fr">{t('settings.languageSettings.french')}</SelectItem>
                  <SelectItem value="de">{t('settings.languageSettings.german')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t('settings.languageSettings.selectHint')}</p>
            </div>
          </CardContent>
        </Card>
        </>
      ),
    },
    // Owners only: members, roles and invitations are an owner's to manage, and the server
    // answers anyone else with 403.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'members',
            label: t('settings.sections.members', 'Members'),
            description: t(
              'settings.sections.membersDescription',
              'Who belongs to the organization, their roles, and invitations for new people.',
            ),
            icon: Users,
            content: <MembersCard />,
          },
        ]
      : []),
    {
      id: 'projects',
      label: t('settings.sections.projects'),
      description: t('settings.sections.projectsDescription'),
      icon: ListTree,
      content: (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><ListTree className="h-4 w-4 text-muted-foreground" /><span>{t('settingsPage.projectManagement.title')}</span></CardTitle>
            <CardDescription>{t('settingsPage.createAndManageYourProjects.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="new-project-name">{t('settingsPage.newProjectName.label')}</Label>
              <div className="flex space-x-2">
                <Input id="new-project-name" placeholder={t('settingsPage.enterProjectName.placeholder')} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} disabled={createProjectMutation.isPending || isPageDisabled} />
                <Button onClick={handleCreateProject} disabled={createProjectMutation.isPending || newProjectName.trim() === "" || isPageDisabled}>
                  {createProjectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />} {t('settingsPage.createProject.button')}
                </Button>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-md font-medium">{t('settingsPage.existingProjects.title')}</h3>
              {isLoadingProjects ? <div className="flex items-center space-x-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span>{t('settingsPage.loadingProjects.text')}</span></div>
                : isErrorProjects ? <p className="text-destructive">Error: {projectsError?.message}</p>
                : projectsData && projectsData.length > 0 ? (
                <ul className="space-y-2">
                  {projectsData.map((project) => (
                    <li key={project.id} className="flex items-center justify-between p-2 border rounded-md" data-testid={`project-${project.id}`}>
                      <span className="text-sm flex items-center gap-2">
                        {project.name}
                        {project.restricted && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Lock className="h-3 w-3" />
                            {t('projectAccess.restrictedBadge', 'restricted')}
                          </Badge>
                        )}
                        {project.access === 'viewer' && user?.role !== 'viewer' && (
                          <Badge variant="secondary" className="text-[10px]">{t('projectAccess.readOnly', 'read-only for you')}</Badge>
                        )}
                      </span>
                      <span className="flex items-center">
                      {user?.role === 'owner' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('projectAccess.open', 'Access to {{name}}', { name: project.name })}
                          onClick={() => setAccessProjectId(project.id)}
                        >
                          <Users className="h-4 w-4" />
                        </Button>
                      )}
                      {/* Icon-only control: without an aria-label it has no accessible name. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('settingsPage.deleteProject.ariaLabel', 'Delete project {{name}}', { name: project.name })}
                        onClick={() => handleDeleteProject(project)}
                        disabled={deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id || isPageDisabled}
                      >
                        {(deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                      </Button>
                      </span>
                    </li>))}
                </ul>) : (<p className="text-sm text-muted-foreground">{t('settingsPage.noProjectsFound.text')}</p>)}
            </div>
          </CardContent>
        </Card>

        {accessProjectId !== null && (
          <ProjectAccessDialog
            projectId={accessProjectId}
            open
            onOpenChange={(open) => {
              if (!open) setAccessProjectId(null);
            }}
          />
        )}
        </>
      ),
    },
    {
      id: 'environments',
      label: t('settings.sections.environments'),
      description: t('settings.sections.environmentsDescription', { token: '{{KEY_NAME}}' }),
      icon: KeyRound,
      content: <EnvironmentsCard />,
    },
    {
      id: 'elements',
      label: t('settings.sections.elements', 'Element repository'),
      description: t(
        'settings.sections.elementsDescription',
        'One definition per element of an application, so a moved button is corrected once rather than in every test that copied it.',
      ),
      icon: Crosshair,
      content: <ElementRepositoryCard />,
    },
    {
      id: 'issueTrackers',
      label: t('settings.sections.issueTrackers', 'Issue trackers'),
      description: t(
        'settings.sections.issueTrackersDescription',
        'Where a failing test becomes somebody’s ticket, in Jira or Azure DevOps.',
      ),
      icon: Bug,
      content: <IssueTrackersCard />,
    },
    {
      id: 'apiKeys',
      label: t('settings.sections.apiKeys', 'API keys'),
      description: t(
        'settings.sections.apiKeysDescription',
        'Credentials for pipelines and scripts, so CI never needs somebody’s password.',
      ),
      icon: KeySquare,
      content: (
        <>
          <ApiKeysCard isOwner={user?.role === 'owner'} />
          {user?.role === 'owner' && <ServiceAccountsCard />}
        </>
      ),
    },
    {
      id: 'sourceHosts',
      label: t('settings.sections.sourceHosts', 'GitHub & GitLab'),
      description: t(
        'settings.sections.sourceHostsDescription',
        'Runs started from a pipeline report pending, passed or failed on the commit they tested.',
      ),
      icon: GitCommitHorizontal,
      content: <SourceHostsCard isOwner={user?.role === 'owner'} />,
    },
    {
      id: 'agents',
      label: t('settings.sections.agents', 'Local agents'),
      description: t(
        'settings.sections.agentsDescription',
        'Machines inside your network that lend their browsers, for applications this server cannot reach.',
      ),
      icon: Laptop,
      content: <AgentsCard isOwner={user?.role === 'owner'} />,
    },
    {
      id: 'security',
      label: t('settings.sections.security', 'Security'),
      description: t(
        'settings.sections.securityDescription',
        'Your second factor at sign-in, and whether the organization requires one.',
      ),
      icon: ShieldCheck,
      content: (
        <div className="space-y-6">
          <SecurityCard isOwner={user?.role === 'owner'} />
          {user?.role === 'owner' && <SsoCard />}
        </div>
      ),
    },
    {
      id: 'runUsage',
      label: t('settings.sections.runUsage', 'Run usage'),
      description: t(
        'settings.sections.runUsageDescription',
        'How many runs this organization has going and waiting, against its limits.',
      ),
      icon: Gauge,
      content: <RunUsageCard />,
    },
    // Owners only, like system settings: a runner serves the whole installation.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'runners',
            label: t('settings.sections.runners', 'Runners'),
            description: t('settings.sections.runnersDescription', 'The machines that run plans: which are up, what they have, and draining one before maintenance.'),
            icon: Server,
            content: <RunnersCard canManage={canManageInstallation} />,
          },
        ]
      : []),
    // Owners only: the trail names who did what, which the server shows no one else either.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'auditLog',
            label: t('settings.sections.auditLog', 'Audit log'),
            description: t(
              'settings.sections.auditLogDescription',
              'Who changed what, when, from where, and whether through an API key.',
            ),
            icon: ScrollText,
            content: <AuditLogCard />,
          },
        ]
      : []),
    {
      id: 'defaults',
      label: t('settings.sections.defaults'),
      description: t('settings.sections.defaultsDescription'),
      icon: SlidersHorizontal,
      footer: userSettingsFooter,
      content: (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Globe className="h-4 w-4 text-muted-foreground" /><span>{t('settings.defaults.title',"Default Configuration")}</span></CardTitle>
            <CardDescription>{t('settings.defaults.description',"Set default values for test creation")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="defaultUrl">{t('settings.defaults.defaultUrlLabel', "Default URL for Test Creation")}</Label>
              <Input id="defaultUrl" type="url" placeholder="https://example.com" value={defaultUrl} onChange={(e) => setDefaultUrl(e.target.value)} disabled={isPageDisabled} />
              <p className="text-sm text-muted-foreground">{t('settings.defaults.defaultUrlDescription', "This URL will be pre-filled when creating new tests")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Monitor className="h-4 w-4 text-muted-foreground" /><span>{t('settings.playwright.title')}</span></CardTitle>
            <CardDescription>{t('settings.playwright.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="browser">{t('settings.playwright.browserLabel')}</Label>
                <Select value={browser} onValueChange={(value: "chromium" | "firefox" | "webkit") => setBrowser(value)} disabled={isPageDisabled}>
                  <SelectTrigger><SelectValue placeholder={t('settings.playwright.browserPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chromium">{t('settingsPage.chromium.text')}</SelectItem><SelectItem value="firefox">{t('settingsPage.firefox.text')}</SelectItem><SelectItem value="webkit">{t('settingsPage.webkitSafari.text')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeout">{t('settings.playwright.timeoutLabel')}</Label>
                <Input id="timeout" type="number" value={defaultTimeout} onChange={(e) => setDefaultTimeout(e.target.value)} disabled={isPageDisabled} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between pt-2">
                <div><Label className="text-sm font-medium">{t('settings.playwright.headlessLabel')}</Label><p className="text-sm text-muted-foreground">{t('settings.playwright.headlessDescription')}</p></div>
                <Switch checked={headless} onCheckedChange={setHeadless} disabled={isPageDisabled} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitTime">{t('settings.playwright.waitLabel')}</Label>
                <Input id="waitTime" type="number" value={waitTime} onChange={(e) => setWaitTime(e.target.value)} disabled={isPageDisabled} />
              </div>
            </div>
          </CardContent>
        </Card>
        </>
      ),
    },
    {
      id: 'system',
      label: t('settings.sections.system'),
      description: t('settings.sections.systemDescription'),
      icon: Archive,
      content: (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Archive className="h-4 w-4 text-muted-foreground" /><span>{t('settings.system.title', 'System Settings')}</span></CardTitle>
            <CardDescription>{t('settings.system.description', 'Manage system-wide configurations.')}</CardDescription>
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
              <Label htmlFor="logRetentionDays">{t('settings.system.logRetentionLabel', 'Log Retention Period (days)')}</Label>
              <Input id="logRetentionDays" type="number" value={logRetentionDays} onChange={(e) => setLogRetentionDays(e.target.value)} disabled={!canManageInstallation || isLoadingLogRetentionSetting || saveLogRetentionMutation.isPending} min="1"/>
              <p className="text-sm text-muted-foreground">{t('settings.system.logRetentionDescription', 'Number of days to keep server logs. Older logs are compressed and then deleted.')}</p>
              {isErrorLogRetentionSetting && (<p className="text-sm text-destructive">{logRetentionSettingError?.message || t('settings.system.fetchError', 'Failed to fetch log retention setting.')}</p>)}
            </div>
            <Button onClick={handleSaveLogRetentionSetting} disabled={!canManageInstallation || isLoadingLogRetentionSetting || saveLogRetentionMutation.isPending || (logRetentionSettingData?.value === logRetentionDays && logRetentionSettingData !== null && !isErrorLogRetentionSetting)}>
              {saveLogRetentionMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saveLogRetentionMutation.isPending ? t('settings.buttons.saving', 'Saving...') : t('settings.system.saveButton', 'Save Log Retention')}
            </Button>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="logLevelSelect">{t('settings.system.logLevelLabel', 'Minimum Log Level')}</Label>
              <Select value={logLevel} onValueChange={setLogLevel} disabled={!canManageInstallation || isLoadingLogLevelSetting || saveLogLevelMutation.isPending}>
                <SelectTrigger id="logLevelSelect">
                  <SelectValue placeholder={t('settings.system.logLevelPlaceholder', 'Select log level...')} />
                </SelectTrigger>
                <SelectContent>
                  {logLevels.map(level => (
                    <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t('settings.system.logLevelDescription', 'Select the minimum level of logs to record. Dynamic update is attempted, otherwise requires application restart.')}</p>
              {isErrorLogLevelSetting && (<p className="text-sm text-destructive">{logLevelSettingError?.message || t('settings.system.fetchErrorLogLevel', 'Failed to fetch log level setting.')}</p>)}
            </div>
            <Button onClick={handleSaveLogLevelSetting} disabled={!canManageInstallation || isLoadingLogLevelSetting || saveLogLevelMutation.isPending || (logLevelSettingData?.value === logLevel && logLevelSettingData !== null && !isErrorLogLevelSetting)}>
              {saveLogLevelMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saveLogLevelMutation.isPending ? t('settings.buttons.saving', 'Saving...') : t('settings.system.saveButtonLogLevel', 'Save Log Level')}
            </Button>
          </CardContent>
        </Card>
        </>
      ),
    },
    {
      id: 'notifications',
      label: t('settings.sections.notifications'),
      description: t('settings.sections.notificationsDescription'),
      icon: Bell,
      content: (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Bell className="h-4 w-4 text-muted-foreground" /><span>{t('settings.notifications.title',"Notifications")}</span></CardTitle>
            <CardDescription>{t('settings.notifications.description',"Choose what notifications you want to receive (Not saved to backend)")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label className="text-sm font-medium">{t('settings.notifications.emailLabel',"Email Notifications")}</Label><p className="text-sm text-muted-foreground">{t('settings.notifications.emailDescription',"Receive updates via email")}</p></div>
              <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} disabled={isPageDisabled} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div><Label className="text-sm font-medium">{t('settings.notifications.testCompletionLabel',"Test Completion")}</Label><p className="text-sm text-muted-foreground">{t('settings.notifications.testCompletionDescription',"Notify when tests finish running")}</p></div>
              <Switch checked={testCompletionNotifications} onCheckedChange={setTestCompletionNotifications} disabled={isPageDisabled} />
            </div>
            <div className="flex items-center justify-between">
              <div><Label className="text-sm font-medium">{t('settings.notifications.errorAlertsLabel',"Error Alerts")}</Label><p className="text-sm text-muted-foreground">{t('settings.notifications.errorAlertsDescription',"Get notified about test failures")}</p></div>
              <Switch checked={errorNotifications} onCheckedChange={setErrorNotifications} disabled={isPageDisabled} />
            </div>
          </CardContent>
        </Card>
        </>
      ),
    },
    {
      id: 'account',
      label: t('settings.sections.account'),
      description: t('settings.sections.accountDescription'),
      icon: User,
      // A "Delete account" button used to sit here that did nothing. Removing a person is an
      // owner's act, in Members, where what they made is handed on.
      content: <ChangePasswordCard />,
    },
  ];

  return (
    <>
      <SettingsLayout
        sections={sections}
        navLabel={t('settings.sections.navLabel')}
        header={
          <PageHeader
            title={t('settings.pageTitle', 'Settings')}
            description={t('settingsPage.description')}
          />
        }
      />

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settingsPage.deleteProjectDialog.title', 'Confirm Project Deletion')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settingsPage.deleteProjectDialog.description', 'Are you sure you want to delete project "{{name}}"? This action cannot be undone.', { name: deletingProjectName || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteConfirmOpen(false);
              setDeletingProjectId(null);
              setDeletingProjectName(null);
            }}>{t('settingsPage.deleteProjectDialog.cancelButton', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('settingsPage.deleteProjectDialog.deleteButton', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
