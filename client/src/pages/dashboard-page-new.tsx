import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { DraggableAction } from "@/components/draggable-action";
import { DraggableElement } from "@/components/draggable-element";
import { TestSequenceBuilder } from "@/components/test-sequence-builder";
import { TestStep as DragDropTestStep } from "@/components/drag-drop-provider";
import { 
  TestTube, 
  Globe, 
  Search, 
  CheckCircle, 
  Settings,
  Bell,
  User,
  Loader2
} from "lucide-react";
import { Link } from "wouter";

// Assuming UserSettings type and fetchSettings function are accessible
// For example, they could be moved to a shared file like 'src/lib/api.ts'
// For this patch, we'll define a simplified version if not directly importable.

interface UserSettings {
  theme: "light" | "dark";
  defaultTestUrl: string | null;
  playwrightBrowser: "chromium" | "firefox" | "webkit";
  playwrightHeadless: boolean;
  playwrightDefaultTimeout: number;
  playwrightWaitTime: number;
}

const fetchSettings = async (): Promise<UserSettings> => {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    // Consider more specific error handling or a generic error
    const errorText = await response.text();
    console.error("Fetch settings error:", errorText);
    throw new Error("Failed to fetch settings");
  }
  return response.json();
};


interface DetectedElement {
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

const availableActions: TestAction[] = [
  { id: "click", type: "click", name: "Click Element", icon: "mouse-pointer", description: "Simulate a mouse click" },
  { id: "input", type: "input", name: "Input Text", icon: "keyboard", description: "Type text into field" },
  { id: "wait", type: "wait", name: "Wait", icon: "clock", description: "Pause execution" },
  { id: "scroll", type: "scroll", name: "Scroll", icon: "scroll", description: "Scroll page or element" },
  { id: "assert", type: "assert", name: "Assert", icon: "check-circle", description: "Verify element or text" },
  { id: "hover", type: "hover", name: "Hover", icon: "hand", description: "Hover over element" },
  { id: "select", type: "select", name: "Select Option", icon: "chevron-down", description: "Choose dropdown option" },
];

export default function DashboardPage() {
  const { user, logoutMutation } = useAuth();
  const { user, logoutMutation } = useAuth();
  // Initial URL state. "https://github.com" is a placeholder that can be overwritten.
  const [currentUrl, setCurrentUrl] = useState("https://github.com");
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [testSequence, setTestSequence] = useState<DragDropTestStep[]>([]);
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null);
  const [isInitialUrlPrefilled, setIsInitialUrlPrefilled] = useState(false);


  // Fetch user settings
  const {
    data: settingsData,
    isLoading: isLoadingUserSettings,
    // isError: isErrorUserSettings, // Can be used for UI feedback if needed
    // error: userSettingsError // Can be used for UI feedback if needed
  } = useQuery<UserSettings, Error>({
    queryKey: ["settings"], // Same key as in SettingsPage for caching
    queryFn: fetchSettings,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Effect to pre-fill URL from user settings
  useEffect(() => {
    if (settingsData?.defaultTestUrl && !isInitialUrlPrefilled) {
      // Only pre-fill if currentUrl is the initial hardcoded one or empty,
      // and defaultTestUrl is actually set.
      if (currentUrl === "https://github.com" || currentUrl === "") {
        setCurrentUrl(settingsData.defaultTestUrl);
      }
      setIsInitialUrlPrefilled(true); // Ensure this runs only once after settings load
    }
    // If settingsData is not yet available, or defaultTestUrl is null,
    // we don't change currentUrl unless it's to clear the initial hardcoded value
    // if no default is provided from settings.
    else if (settingsData && settingsData.defaultTestUrl === null && currentUrl === "https://github.com" && !isInitialUrlPrefilled) {
      setCurrentUrl(""); // Clear initial placeholder if no default is set in settings
      setIsInitialUrlPrefilled(true);
    }
    // If settings have loaded, and there's no defaultTestUrl, and the user hasn't changed the URL,
    // then clear the placeholder. This handles the case where the initial placeholder should be removed.
    else if (settingsData && !settingsData.defaultTestUrl && currentUrl === "https://github.com" && !isInitialUrlPrefilled ) {
        setCurrentUrl("");
        setIsInitialUrlPrefilled(true);
    }

  }, [settingsData, currentUrl, isInitialUrlPrefilled]);

  const loadWebsiteMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/load-website", { url });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setWebsiteLoaded(true);
        setWebsiteScreenshot(data.screenshot);
        toast({
          title: "Website loaded",
          description: "Website loaded successfully in preview",
        });
      } else {
        throw new Error(data.error || "Failed to load website");
      }
    },
    onError: (error: Error) => {
      setWebsiteLoaded(false);
      setWebsiteScreenshot(null);
      toast({
        title: "Failed to load website",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const detectElementsMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/detect-elements", { url });
      return res.json();
    },
    onSuccess: (data) => {
      setDetectedElements(data.elements);
      toast({
        title: "Elements detected",
        description: `Found ${data.elements.length} elements on the page`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to detect elements",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveTestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tests", {
        name: `Test for ${currentUrl}`,
        url: currentUrl,
        sequence: testSequence,
        elements: detectedElements,
        status: "saved"
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Test saved",
        description: "Your test has been saved successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save test",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLoadWebsite = () => {
    if (!currentUrl) return;
    loadWebsiteMutation.mutate(currentUrl);
  };

  const handleDetectElements = () => {
    if (!currentUrl) return;
    detectElementsMutation.mutate(currentUrl);
  };

  const handleSaveTest = () => {
    if (testSequence.length === 0) {
      toast({
        title: "No test steps",
        description: "Add some test steps before saving",
        variant: "destructive",
      });
      return;
    }
    saveTestMutation.mutate();
  };

  const handleClearSequence = () => {
    setTestSequence([]);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <TestTube className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold text-card-foreground">WebTest Platform</h1>
            </div>
            
            <nav className="hidden md:flex space-x-6">
              <span className="text-primary font-medium border-b-2 border-primary pb-2">Create Test</span>
              <span className="text-muted-foreground hover:text-foreground pb-2 cursor-pointer">My Tests</span>
              <span className="text-muted-foreground hover:text-foreground pb-2 cursor-pointer">Reports</span>
            </nav>
          </div>
          
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Button>
            <Link href="/settings" aria-label="Settings">
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center space-x-2">
              <User className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{user?.username}</span>
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

      {/* URL Input Section */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <Label htmlFor="urlInput" className="block text-sm font-medium text-card-foreground mb-2">Website URL to Test</Label>
            <div className="flex space-x-3">
              <Input
                id="urlInput"
                type="url"
                className="flex-1"
                placeholder="https://example.com"
                value={currentUrl}
                onChange={(e) => setCurrentUrl(e.target.value)}
              />
              <Button
                onClick={handleLoadWebsite}
                disabled={loadWebsiteMutation.isPending || isLoadingUserSettings}
              >
                {loadWebsiteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                {loadWebsiteMutation.isPending ? "Loading..." : "Load Website"}
              </Button>
              <Button
                onClick={handleDetectElements}
                disabled={detectElementsMutation.isPending || !websiteLoaded || isLoadingUserSettings}
                variant="secondary"
              >
                {detectElementsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                {detectElementsMutation.isPending ? "Detecting..." : "Detect Elements"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area - Two-level layout */}
      <div className="flex-1 flex flex-col">
        {/* Top section: Actions, Preview, Elements (60% of viewport) */}
        <div className="flex h-[60vh] border-b border-border">
          {/* Left Sidebar - Actions */}
          <div className="w-80 bg-card border-r border-border p-4">
            <h3 className="text-lg font-semibold text-card-foreground mb-4">Available Actions</h3>
            
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {availableActions.map((action) => (
                  <DraggableAction key={action.id} action={action} />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Center - Website Preview (Prominent and well-visible) */}
          <div className="flex-1 bg-card border-r border-border p-4">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-card-foreground">Website Preview</h3>
                <div className="flex items-center space-x-2">
                  {websiteLoaded && (
                    <Badge variant="secondary" className="bg-success text-primary-foreground"> {/* Assuming success acts like a primary button bg */}
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Loaded
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="flex-1 border-2 border-border rounded-lg overflow-hidden relative bg-muted"> {/* Changed bg-white to bg-muted for slight contrast */}
                {websiteLoaded && websiteScreenshot ? (
                  <div className="w-full h-full overflow-auto bg-muted relative"> {/* Changed bg-white to bg-muted */}
                    <img 
                      src={websiteScreenshot} 
                      alt="Website screenshot"
                      className="w-full h-auto object-contain"
                      style={{ minHeight: '100%' }}
                    />
                    {/* Element highlighting overlay based on real boundingBox data */}
                    {highlightedElement && detectedElements.find(el => el.id === highlightedElement)?.boundingBox && (
                      <div 
                        className="absolute border-2 border-destructive bg-destructive/20 pointer-events-none" /* Used destructive theme color */
                        style={{
                          top: `${detectedElements.find(el => el.id === highlightedElement)?.boundingBox?.y}px`,
                          left: `${detectedElements.find(el => el.id === highlightedElement)?.boundingBox?.x}px`,
                          width: `${detectedElements.find(el => el.id === highlightedElement)?.boundingBox?.width}px`,
                          height: `${detectedElements.find(el => el.id === highlightedElement)?.boundingBox?.height}px`
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Load a website to see the preview</p>
                      <p className="text-sm mt-2">Real website screenshots will appear here</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar - Detected Elements */}
          <div className="w-80 bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-card-foreground">Detected Elements</h3>
              <Badge variant="secondary">{detectedElements.length} found</Badge>
            </div>
            
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {detectedElements.map((element) => (
                  <DraggableElement 
                    key={element.id} 
                    element={element} 
                    onHover={setHighlightedElement}
                  />
                ))}
                
                {detectedElements.length === 0 && (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <div className="text-center">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No elements detected yet</p>
                      <p className="text-xs">Load a website and click "Detect Elements"</p>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Bottom section: Test Sequence Builder (40% of viewport) */}
        <div className="h-[40vh] bg-card p-6"> {/* Changed bg-white to bg-card */}
          <TestSequenceBuilder
            testSequence={testSequence}
            onUpdateSequence={setTestSequence}
            onExecuteTest={() => {
              toast({
                title: "Test execution",
                description: "Test execution feature will be implemented with real Playwright automation",
              });
            }}
            onSaveTest={handleSaveTest}
            onClearSequence={handleClearSequence}
            isExecuting={false}
            isSaving={saveTestMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}