import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
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
  ArrowLeft
} from "lucide-react";
import { Link } from "wouter";

export default function SettingsPage() {
  const { user, logoutMutation } = useAuth();
  
  // Theme settings
  const [darkMode, setDarkMode] = useState(false);
  
  // Default URL setting
  const [defaultUrl, setDefaultUrl] = useState("https://github.com");
  
  // Playwright preferences
  const [browser, setBrowser] = useState("chromium");
  const [headless, setHeadless] = useState(true);
  const [defaultTimeout, setDefaultTimeout] = useState("30000");
  const [waitTime, setWaitTime] = useState("1000");
  
  // Notification settings
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [testCompletionNotifications, setTestCompletionNotifications] = useState(true);
  const [errorNotifications, setErrorNotifications] = useState(true);

  const handleSaveSettings = () => {
    // In a real implementation, this would save to the backend
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated successfully",
    });
  };

  const handleResetSettings = () => {
    setDarkMode(false);
    setDefaultUrl("https://github.com");
    setBrowser("chromium");
    setHeadless(true);
    setDefaultTimeout("30000");
    setWaitTime("1000");
    setEmailNotifications(true);
    setTestCompletionNotifications(true);
    setErrorNotifications(true);
    
    toast({
      title: "Settings reset",
      description: "All settings have been reset to defaults",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
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
              <h1 className="text-xl font-bold text-gray-900">Settings</h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon">
              <Bell className="h-4 w-4" />
            </Button>
            <div className="flex items-center space-x-2">
              <User className="h-6 w-6 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">{user?.username}</span>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
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
                <p className="text-sm text-gray-500">Switch between light and dark themes</p>
              </div>
              <div className="flex items-center space-x-2">
                <Sun className="h-4 w-4" />
                <Switch
                  checked={darkMode}
                  onCheckedChange={setDarkMode}
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
              />
              <p className="text-sm text-gray-500">
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
                <Select value={browser} onValueChange={setBrowser}>
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
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Headless Mode</Label>
                  <p className="text-sm text-gray-500">Run browsers without GUI</p>
                </div>
                <Switch
                  checked={headless}
                  onCheckedChange={setHeadless}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="waitTime">Default Wait Time (ms)</Label>
                <Input
                  id="waitTime"
                  type="number"
                  value={waitTime}
                  onChange={(e) => setWaitTime(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bell className="h-5 w-5" />
              <span>Notifications</span>
            </CardTitle>
            <CardDescription>
              Choose what notifications you want to receive
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Email Notifications</Label>
                <p className="text-sm text-gray-500">Receive updates via email</p>
              </div>
              <Switch
                checked={emailNotifications}
                onCheckedChange={setEmailNotifications}
              />
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Test Completion</Label>
                <p className="text-sm text-gray-500">Notify when tests finish running</p>
              </div>
              <Switch
                checked={testCompletionNotifications}
                onCheckedChange={setTestCompletionNotifications}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Error Alerts</Label>
                <p className="text-sm text-gray-500">Get notified about test failures</p>
              </div>
              <Switch
                checked={errorNotifications}
                onCheckedChange={setErrorNotifications}
              />
            </div>
          </CardContent>
        </Card>

        {/* Account Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="h-5 w-5" />
              <span>Account</span>
            </CardTitle>
            <CardDescription>
              Manage your account settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={user?.username || ""} disabled />
              <p className="text-sm text-gray-500">
                Username cannot be changed after registration
              </p>
            </div>
            
            <Separator />
            
            <div>
              <Label className="text-sm font-medium text-red-600">Danger Zone</Label>
              <p className="text-sm text-gray-500 mb-3">
                These actions cannot be undone
              </p>
              <Button variant="destructive" size="sm">
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleResetSettings}>
            Reset to Defaults
          </Button>
          
          <div className="flex space-x-3">
            <Link href="/">
              <Button variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button onClick={handleSaveSettings}>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}