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
} from "lucide-react";
import { Link } from "wouter";
import { UserSettings, fetchSettings } from "../lib/settings"; // Import from shared file

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

export default function SettingsPage() {
  const { user, logoutMutation } = useAuth();
  const queryClient = useQueryClient();

  // Local state for form elements
  const [darkMode, setDarkMode] = useState(false); // true for dark, false for light
  const [defaultUrl, setDefaultUrl] = useState(""); // Initialize with empty or default
  const [browser, setBrowser] = useState<"chromium" | "firefox" | "webkit">("chromium");
  const [headless, setHeadless] = useState(true);
  const [defaultTimeout, setDefaultTimeout] = useState("30000");
  const [waitTime, setWaitTime] = useState("1000");

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
        title: "Settings saved",
        description: "Your preferences have been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error saving settings",
        description: error.message || "An unexpected error occurred.",
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
    setEmailNotifications(true); // These are not part of user_settings table
    setTestCompletionNotifications(true);
    setErrorNotifications(true);
    
    toast({
      title: "Settings reset",
      description: "Local form has been reset. Fetched settings may differ.",
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
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
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
              <span>Appearance</span>
            </CardTitle>
            <CardDescription>
              Customize the look and feel of the application
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Switch between light and dark themes</p>
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
            Reset Form
          </Button>
          
          <div className="flex space-x-3">
            <Link href="/">
              <Button variant="ghost" disabled={mutation.isPending || isLoadingSettings}>
                Cancel
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
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}