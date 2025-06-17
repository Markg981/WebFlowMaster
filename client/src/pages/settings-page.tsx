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
  TestTube,
  Moon,
  Sun,
  Globe, 
  Clock, 
  Monitor,
  Settings,
  Bell,
  User,
  Save,
  ArrowLeft,
  Loader2, // For loading state
  ListTree, // Added for Project Management
  Trash2,   // Added for Project Management
  PlusCircle, // Added for Project Management
} from "lucide-react";
import { Link } from "wouter";
import { UserSettings, fetchSettings } from "../lib/settings"; // Import from shared file

// Define Project type locally if not importable from shared
interface Project {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
}

// API interaction functions
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

// API functions for Project Management
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
  if (!response.ok && response.status !== 204) { // 204 is a success status with no content
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to delete project");
  }
  // For 204, response.json() would error, so we don't parse it.
  if (response.status === 204) return;
  // If not 204 but still ok (e.g. 200 with content, though not expected for DELETE), parse it.
  // This case should ideally not happen for a DELETE returning 204.
  if (response.ok) return response.json();
};


export default function SettingsPage() {
  const { t } = useTranslation(); // Initialize useTranslation
  const { user, logoutMutation } = useAuth();
  const queryClient = useQueryClient();

  // Project Management State
  const [newProjectName, setNewProjectName] = useState("");

  // Query for fetching projects
  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    isError: isErrorProjects,
    error: projectsError
  } = useQuery<Project[], Error>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  // Mutation for creating a project
  const createProjectMutation = useMutation<Project, Error, string>({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project Created", description: "The new project has been created successfully." });
      setNewProjectName(""); // Clear input field
    },
    onError: (error) => {
      toast({
        title: "Error Creating Project",
        description: error.message || "An unknown error occurred.",
        variant: "destructive",
      });
    },
  });

  // Mutation for deleting a project
  const deleteProjectMutation = useMutation<void, Error, number>({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project Deleted", description: "The project has been deleted successfully." });
    },
    onError: (error) => {
      toast({
        title: "Error Deleting Project",
        description: error.message || "An unknown error occurred.",
        variant: "destructive",
      });
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
    if (window.confirm("Are you sure you want to delete this project? This will also remove it from any associated tests.")) {
      deleteProjectMutation.mutate(projectId);
    }
  };

  // Local state for form elements
  const [darkMode, setDarkMode] = useState(false); // true for dark, false for light
  const [defaultUrl, setDefaultUrl] = useState(""); // Initialize with empty or default
  const [browser, setBrowser] = useState<"chromium" | "firefox" | "webkit">("chromium");
  const [headless, setHeadless] = useState(true);
  const [defaultTimeout, setDefaultTimeout] = useState("30000");
  const [waitTime, setWaitTime] = useState("1000");
  const [language, setLanguage] = useState("en"); // Add language state, default to 'en'

  // Fetch settings using useQuery
  const {
    data: settingsData,
    isLoading: isLoadingSettings,
    isError: isErrorSettings,
    error: settingsError
  } = useQuery<UserSettings, Error>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  // Effect to initialize local state from fetched settings
  useEffect(() => {
    if (settingsData) {
      setDarkMode(settingsData.theme === "dark");
      setDefaultUrl(settingsData.defaultTestUrl || ""); // API returns '' for null
      setBrowser(settingsData.playwrightBrowser);
      setHeadless(settingsData.playwrightHeadless);
      setDefaultTimeout(String(settingsData.playwrightDefaultTimeout));
      setWaitTime(String(settingsData.playwrightWaitTime));
      setLanguage(settingsData.language || "en"); // Initialize language
    }
  }, [settingsData]);

  // Effect to toggle dark mode class on document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);
  
  // Notification settings (not part of this subtask's scope for user_settings table)
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [testCompletionNotifications, setTestCompletionNotifications] = useState(true);
  const [errorNotifications, setErrorNotifications] = useState(true);

  // Mutation for saving settings
  const mutation = useMutation<UserSettings, Error, Partial<UserSettings>>({
    mutationFn: saveSettings,
    onSuccess: (savedData) => {
      queryClient.setQueryData(["settings"], savedData); // Update cache immediately
      // queryClient.invalidateQueries({ queryKey: ["settings"] }); // Or invalidate and refetch
      toast({
        title: t('settings.toast.savedTitle'), // Example of using t function
        description: t('settings.toast.savedDescription'),
      });
    },
    onError: (error) => {
      toast({
        title: t('settings.toast.errorTitle'),
        description: error.message || t('settings.toast.errorDescription'),
        variant: "destructive",
      });
    },
  });

  const handleSaveSettings = () => {
    const settingsToSave: Partial<UserSettings> = {
      theme: darkMode ? "dark" : "light",
      defaultTestUrl: defaultUrl === "" ? null : defaultUrl, // API expects null for empty
      playwrightBrowser: browser,
      playwrightHeadless: headless,
      playwrightDefaultTimeout: parseInt(defaultTimeout, 10),
      playwrightWaitTime: parseInt(waitTime, 10),
      language: language, // Add language to settings being saved
    };

    // Validate numeric inputs
    if (isNaN(settingsToSave.playwrightDefaultTimeout!) || settingsToSave.playwrightDefaultTimeout! <= 0) {
      toast({ title: "Invalid Timeout", description: "Default timeout must be a positive number.", variant: "destructive" });
      return;
    }
    if (isNaN(settingsToSave.playwrightWaitTime!) || settingsToSave.playwrightWaitTime! <= 0) {
      toast({ title: "Invalid Wait Time", description: "Wait time must be a positive number.", variant: "destructive" });
      return;
    }

    mutation.mutate(settingsToSave);
  };

  const handleResetSettings = () => {
    // Reset to application defaults, or refetch from server if desired
    // For now, using hardcoded defaults similar to original
    setDarkMode(false);
    setDefaultUrl(""); // Default for GET is '', so reset to that
    setBrowser("chromium");
    setHeadless(true); // Default for GET
    setDefaultTimeout("30000"); // Default for GET
    setWaitTime("1000"); // Default for GET
    setLanguage("en"); // Reset language to English
    setEmailNotifications(true); // These are not part of user_settings table
    setTestCompletionNotifications(true);
    setErrorNotifications(true);
    
    toast({
      title: t('settings.toast.resetTitle'),
      description: t('settings.toast.resetDescription'),
    });
  };

  if (isLoadingSettings) {
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
        <p className="mt-4 text-lg text-red-600">Error loading settings:</p>
        <p className="text-sm text-gray-700">{settingsError?.message || "An unknown error occurred."}</p>
        <Button onClick={() => queryClient.refetchQueries({ queryKey: ['settings'] })} className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground"> {/* Apply dark mode classes */}
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4"> {/* Apply dark mode classes */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard"> {/* Changed href to /dashboard */}
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('nav.backToDashboard')} {/* Used translation key */}
              </Button>
            </Link>
            
            <div className="flex items-center space-x-2">
              <Settings className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Settings</h1> {/* Apply dark mode classes */}
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* <Button variant="ghost" size="icon">
              <Bell className="h-4 w-4" />
            </Button> */}
            <div className="flex items-center space-x-2">
              <User className="h-6 w-6" /> {/* Apply dark mode classes */}
              <span className="text-sm font-medium">{user?.username}</span> {/* Apply dark mode classes */}
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending || mutation.isPending}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Settings Content */}
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Appearance Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Sun className="h-5 w-5" />
              <span>{t('settings.appearance.title')}</span>
            </CardTitle>
            <CardDescription>
              {t('settings.appearance.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{t('settings.appearance.darkModeLabel')}</Label>
                <p className="text-sm text-muted-foreground">{t('settings.appearance.darkModeDescription')}</p>
              </div>
              <div className="flex items-center space-x-2">
                <Sun className="h-4 w-4" />
                <Switch
                  checked={darkMode}
                  onCheckedChange={setDarkMode}
                  disabled={mutation.isPending || isLoadingSettings}
                />
                <Moon className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Language Settings Card - NEW */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Globe className="h-5 w-5" />
              <span>{t('settings.languageSettings.title')}</span>
            </CardTitle>
            <CardDescription>
              {t('settings.languageSettings.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="language-select">{t('settings.languageSettings.selectLabel')}</Label>
              <Select
                value={language}
                onValueChange={(value: string) => setLanguage(value)}
                disabled={mutation.isPending || isLoadingSettings}
              >
                <SelectTrigger id="language-select">
                  <SelectValue placeholder={t('settings.languageSettings.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('settings.languageSettings.english')}</SelectItem>
                  <SelectItem value="it">{t('settings.languageSettings.italian')}</SelectItem>
                  <SelectItem value="fr">{t('settings.languageSettings.french')}</SelectItem> {/* New */}
                  <SelectItem value="de">{t('settings.languageSettings.german')}</SelectItem> {/* New */}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {t('settings.languageSettings.selectHint')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Project Management Card - NEW */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <ListTree className="h-5 w-5" />
              <span>Project Management</span>
            </CardTitle>
            <CardDescription>
              Create and manage your projects. Assigning tests to projects can help organize your work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Create Project Section */}
            <div className="space-y-2">
              <Label htmlFor="new-project-name">New Project Name</Label>
              <div className="flex space-x-2">
                <Input
                  id="new-project-name"
                  placeholder="Enter project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  disabled={createProjectMutation.isPending}
                />
                <Button
                  onClick={handleCreateProject}
                  disabled={createProjectMutation.isPending || newProjectName.trim() === ""}
                >
                  {createProjectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4 mr-2" />
                  )}
                  Create Project
                </Button>
              </div>
            </div>

            <Separator />

            {/* Project List Section */}
            <div className="space-y-2">
              <h3 className="text-md font-medium">Existing Projects</h3>
              {isLoadingProjects ? (
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading projects...</span>
                </div>
              ) : isErrorProjects ? (
                <p className="text-red-600">Error loading projects: {projectsError?.message}</p>
              ) : projectsData && projectsData.length > 0 ? (
                <ul className="space-y-2">
                  {projectsData.map((project) => (
                    <li key={project.id} className="flex items-center justify-between p-2 border rounded-md">
                      <span className="text-sm">{project.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteProject(project.id)}
                        disabled={deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id}
                      >
                        {deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-red-500" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No projects found. Create one above!</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Default Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Globe className="h-5 w-5" />
              <span>Default Configuration</span>
            </CardTitle>
            <CardDescription>
              Set default values for test creation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="defaultUrl">Default URL for Test Creation</Label>
              <Input
                id="defaultUrl"
                type="url"
                placeholder="https://example.com"
                value={defaultUrl}
                onChange={(e) => setDefaultUrl(e.target.value)}
                disabled={mutation.isPending || isLoadingSettings}
              />
              <p className="text-sm text-muted-foreground">
                This URL will be pre-filled when creating new tests
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Playwright Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Monitor className="h-5 w-5" />
              <span>Browser Automation Settings</span>
            </CardTitle>
            <CardDescription>
              Configure Playwright behavior for test execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="browser">Preferred Browser</Label>
                <Select
                  value={browser}
                  onValueChange={(value: "chromium" | "firefox" | "webkit") => setBrowser(value)}
                  disabled={mutation.isPending || isLoadingSettings}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select browser" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chromium">Chromium</SelectItem>
                    <SelectItem value="firefox">Firefox</SelectItem>
                    <SelectItem value="webkit">WebKit (Safari)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="timeout">Default Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={defaultTimeout}
                  onChange={(e) => setDefaultTimeout(e.target.value)}
                  disabled={mutation.isPending || isLoadingSettings}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between pt-2"> {/* Added pt-2 for alignment */}
                <div>
                  <Label className="text-sm font-medium">Headless Mode</Label>
                  <p className="text-sm text-muted-foreground">Run browsers without GUI</p>
                </div>
                <Switch
                  checked={headless}
                  onCheckedChange={setHeadless}
                  disabled={mutation.isPending || isLoadingSettings}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="waitTime">Default Wait Time (ms)</Label>
                <Input
                  id="waitTime"
                  type="number"
                  value={waitTime}
                  onChange={(e) => setWaitTime(e.target.value)}
                  disabled={mutation.isPending || isLoadingSettings}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications (Scope of this card is not part of user_settings) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bell className="h-5 w-5" />
              <span>Notifications</span>
            </CardTitle>
            <CardDescription>
              Choose what notifications you want to receive (Not saved to backend)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive updates via email</p>
              </div>
              <Switch
                checked={emailNotifications}
                onCheckedChange={setEmailNotifications}
                disabled={mutation.isPending || isLoadingSettings}
              />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Test Completion</Label>
                <p className="text-sm text-muted-foreground">Notify when tests finish running</p>
              </div>
              <Switch
                checked={testCompletionNotifications}
                onCheckedChange={setTestCompletionNotifications}
                disabled={mutation.isPending || isLoadingSettings}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Error Alerts</Label>
                <p className="text-sm text-muted-foreground">Get notified about test failures</p>
              </div>
              <Switch
                checked={errorNotifications}
                onCheckedChange={setErrorNotifications}
                disabled={mutation.isPending || isLoadingSettings}
              />
            </div>
          </CardContent>
        </Card>

        {/* Account Settings (Scope of this card is not part of user_settings) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="h-5 w-5" />
              <span>Account</span>
            </CardTitle>
            <CardDescription>
              Manage your account settings (Not saved to backend)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={user?.username || ""} disabled />
              <p className="text-sm text-muted-foreground">
                Username cannot be changed after registration
              </p>
            </div>
            
            <Separator />
            
            <div>
              <Label className="text-sm font-medium text-destructive">Danger Zone</Label>
              <p className="text-sm text-muted-foreground mb-3">
                These actions cannot be undone
              </p>
              <Button variant="destructive" size="sm" disabled={mutation.isPending || isLoadingSettings}>
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={handleResetSettings}
            disabled={mutation.isPending || isLoadingSettings}
          >
            {t('settings.buttons.resetForm')}
          </Button>
          
          <div className="flex space-x-3">
            <Link href="/">
              <Button variant="ghost" disabled={mutation.isPending || isLoadingSettings}>
                {t('settings.buttons.cancel')}
              </Button>
            </Link>
            <Button
              onClick={handleSaveSettings}
              disabled={mutation.isPending || isLoadingSettings}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {mutation.isPending ? t('settings.buttons.saving') : t('settings.buttons.saveSettings')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}