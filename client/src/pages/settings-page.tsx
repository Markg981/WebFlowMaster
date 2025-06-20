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
  Settings,
  Bell,
  User,
  Save,
  ArrowLeft,
  Loader2,
  ListTree,
  Trash2,
  PlusCircle,
  Archive,
} from "lucide-react";
import { Link } from "wouter";
import { UserSettings, fetchSettings } from "../lib/settings";

interface Project {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
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
  const queryClient = useQueryClient();

  const [newProjectName, setNewProjectName] = useState("");
  const [logRetentionDays, setLogRetentionDays] = useState<string>("7");
  const [logLevel, setLogLevel] = useState<string>("info"); // New state for log level

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

  const handleDeleteProject = (projectId: number) => {
    if (window.confirm("Are you sure you want to delete this project?")) {
      deleteProjectMutation.mutate(projectId);
    }
  };

  const [darkMode, setDarkMode] = useState(false);
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
      setDarkMode(settingsData.theme === "dark");
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
    if (darkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [darkMode]);

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
      toast({ title: t('settings.system.toast.logRetentionSavedTitle', 'Log Retention Saved'), description: t('settings.system.toast.logRetentionSavedDescription', `Log retention period set to ${savedSetting.value} days.`, { days: savedSetting.value }) });
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
      toast({ title: t('settings.system.toast.logLevelSavedTitle', 'Log Level Saved'), description: t('settings.system.toast.logLevelSavedDescription', `Minimum log level set to ${savedSetting.value}.`, { level: savedSetting.value }) });
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
      theme: darkMode ? "dark" : "light",
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
    setDarkMode(false);
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg">Loading settings...</p>
      </div>
    );
  }

  if (isErrorSettings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Bell className="h-12 w-12 text-red-500" />
        <p className="mt-4 text-lg text-red-600">Error loading user settings:</p>
        <p className="text-sm text-gray-700">{settingsError?.message || "An unknown error occurred."}</p>
        <Button onClick={() => queryClient.refetchQueries({ queryKey: ['settings'] })} className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Settings className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">{t('settings.pageTitle', 'Settings')}</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <User className="h-6 w-6" />
              <span className="text-sm font-medium">{user?.username}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => logoutMutation.mutate()} disabled={isPageDisabled}>
              {t('settings.buttons.signOut', 'Sign Out')}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Sun className="h-5 w-5" /><span>{t('settings.appearance.title')}</span></CardTitle>
            <CardDescription>{t('settings.appearance.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{t('settings.appearance.darkModeLabel')}</Label>
                <p className="text-sm text-muted-foreground">{t('settings.appearance.darkModeDescription')}</p>
              </div>
              <div className="flex items-center space-x-2">
                <Sun className="h-4 w-4" /><Switch checked={darkMode} onCheckedChange={setDarkMode} disabled={isPageDisabled} /><Moon className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Globe className="h-5 w-5" /><span>{t('settings.languageSettings.title')}</span></CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><ListTree className="h-5 w-5" /><span>Project Management</span></CardTitle>
            <CardDescription>Create and manage your projects.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="new-project-name">New Project Name</Label>
              <div className="flex space-x-2">
                <Input id="new-project-name" placeholder="Enter project name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} disabled={createProjectMutation.isPending || isPageDisabled} />
                <Button onClick={handleCreateProject} disabled={createProjectMutation.isPending || newProjectName.trim() === "" || isPageDisabled}>
                  {createProjectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />} Create Project
                </Button>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-md font-medium">Existing Projects</h3>
              {isLoadingProjects ? <div className="flex items-center space-x-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span>Loading projects...</span></div>
                : isErrorProjects ? <p className="text-red-600">Error: {projectsError?.message}</p>
                : projectsData && projectsData.length > 0 ? (
                <ul className="space-y-2">
                  {projectsData.map((project) => (
                    <li key={project.id} className="flex items-center justify-between p-2 border rounded-md">
                      <span className="text-sm">{project.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteProject(project.id)} disabled={deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id || isPageDisabled}>
                        {(deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                      </Button>
                    </li>))}
                </ul>) : (<p className="text-sm text-muted-foreground">No projects found.</p>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Globe className="h-5 w-5" /><span>{t('settings.defaults.title',"Default Configuration")}</span></CardTitle>
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
            <CardTitle className="flex items-center space-x-2"><Monitor className="h-5 w-5" /><span>{t('settings.playwright.title')}</span></CardTitle>
            <CardDescription>{t('settings.playwright.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="browser">{t('settings.playwright.browserLabel')}</Label>
                <Select value={browser} onValueChange={(value: "chromium" | "firefox" | "webkit") => setBrowser(value)} disabled={isPageDisabled}>
                  <SelectTrigger><SelectValue placeholder={t('settings.playwright.browserPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chromium">Chromium</SelectItem><SelectItem value="firefox">Firefox</SelectItem><SelectItem value="webkit">WebKit (Safari)</SelectItem>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Archive className="h-5 w-5" /><span>{t('settings.system.title', 'System Settings')}</span></CardTitle>
            <CardDescription>{t('settings.system.description', 'Manage system-wide configurations.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="logRetentionDays">{t('settings.system.logRetentionLabel', 'Log Retention Period (days)')}</Label>
              <Input id="logRetentionDays" type="number" value={logRetentionDays} onChange={(e) => setLogRetentionDays(e.target.value)} disabled={isLoadingLogRetentionSetting || saveLogRetentionMutation.isPending} min="1"/>
              <p className="text-sm text-muted-foreground">{t('settings.system.logRetentionDescription', 'Number of days to keep server logs. Older logs are compressed and then deleted.')}</p>
              {isErrorLogRetentionSetting && (<p className="text-sm text-red-600">{logRetentionSettingError?.message || t('settings.system.fetchError', 'Failed to fetch log retention setting.')}</p>)}
            </div>
            <Button onClick={handleSaveLogRetentionSetting} disabled={isLoadingLogRetentionSetting || saveLogRetentionMutation.isPending || (logRetentionSettingData?.value === logRetentionDays && logRetentionSettingData !== null && !isErrorLogRetentionSetting)}>
              {saveLogRetentionMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saveLogRetentionMutation.isPending ? t('settings.buttons.saving', 'Saving...') : t('settings.system.saveButton', 'Save Log Retention')}
            </Button>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="logLevelSelect">{t('settings.system.logLevelLabel', 'Minimum Log Level')}</Label>
              <Select value={logLevel} onValueChange={setLogLevel} disabled={isLoadingLogLevelSetting || saveLogLevelMutation.isPending}>
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
              {isErrorLogLevelSetting && (<p className="text-sm text-red-600">{logLevelSettingError?.message || t('settings.system.fetchErrorLogLevel', 'Failed to fetch log level setting.')}</p>)}
            </div>
            <Button onClick={handleSaveLogLevelSetting} disabled={isLoadingLogLevelSetting || saveLogLevelMutation.isPending || (logLevelSettingData?.value === logLevel && logLevelSettingData !== null && !isErrorLogLevelSetting)}>
              {saveLogLevelMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saveLogLevelMutation.isPending ? t('settings.buttons.saving', 'Saving...') : t('settings.system.saveButtonLogLevel', 'Save Log Level')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Bell className="h-5 w-5" /><span>{t('settings.notifications.title',"Notifications")}</span></CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><User className="h-5 w-5" /><span>{t('settings.account.title',"Account")}</span></CardTitle>
            <CardDescription>{t('settings.account.description',"Manage your account settings (Not saved to backend)")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.account.usernameLabel',"Username")}</Label><Input value={user?.username || ""} disabled /><p className="text-sm text-muted-foreground">{t('settings.account.usernameDescription',"Username cannot be changed after registration")}</p>
            </div>
            <Separator />
            <div>
              <Label className="text-sm font-medium text-destructive">{t('settings.account.dangerZoneLabel',"Danger Zone")}</Label>
              <p className="text-sm text-muted-foreground mb-3">{t('settings.account.dangerZoneDescription',"These actions cannot be undone")}</p>
              <Button variant="destructive" size="sm" disabled={isPageDisabled}>{t('settings.account.deleteAccountButton',"Delete Account")}</Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={handleResetSettings} disabled={isPageDisabled}>{t('settings.buttons.resetForm')}</Button>
          <div className="flex space-x-3">
            <Link href="/"><Button variant="ghost" disabled={isPageDisabled}>{t('settings.buttons.cancel')}</Button></Link>
            <Button onClick={handleSaveUserSettings} disabled={isPageDisabled}>
              {userSettingsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {userSettingsMutation.isPending ? t('settings.buttons.saving') : t('settings.buttons.saveUserSettings', 'Save User Settings')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}