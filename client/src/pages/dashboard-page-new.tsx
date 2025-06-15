import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, QueryClient } from "@tanstack/react-query";
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
  Loader2,
  Play,
  Pause,
  StopCircle,
} from "lucide-react";
import { Link } from "wouter";

// Client-side StepResult interface matching backend
interface StepResult {
  name: string;
  type: string;
  selector?: string;
  value?: string;
  status: 'passed' | 'failed';
  screenshot?: string;
  error?: string;
  details: string;
}

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
  // Initial URL state. "https://github.com" is a placeholder that can be overwritten.
  const [currentUrl, setCurrentUrl] = useState("https://github.com");
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [testSequence, setTestSequence] = useState<DragDropTestStep[]>([]);
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null); // This will now also be used for playback
  const [isInitialUrlPrefilled, setIsInitialUrlPrefilled] = useState(false);

  // States for test execution playback
  const [isExecutingPlayback, setIsExecutingPlayback] = useState(false);
  const [currentPlaybackStepIndex, setCurrentPlaybackStepIndex] = useState<number | null>(null);
  const [playbackSteps, setPlaybackSteps] = useState<StepResult[]>([]);
  const [currentSavedTestId, setCurrentSavedTestId] = useState<string | null>(null); // To store ID of saved/loaded test
  const [testName, setTestName] = useState<string>(""); // To store test name


  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null); // Ref for the div that provides dimensions for scaling
  const [imageRenderDimensions, setImageRenderDimensions] = useState<{
    renderedWidth: number; // Width of the container where image is rendered (imageContainerRef.clientWidth)
    renderedHeight: number; // Height of the container where image is rendered (imageContainerRef.clientHeight)
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);


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

  }, [settingsData, currentUrl, isInitialUrlPrefilled]); // Removed setCurrentUrl and setIsInitialUrlPrefilled from deps as they are setters

  // Effect to capture image dimensions and observe container resize
  useEffect(() => {
    const imgElement = imageRef.current;
    const container = imageContainerRef.current;

    const updateDimensions = () => {
      if (imgElement && imgElement.complete && imgElement.naturalWidth > 0 && container) {
        setImageRenderDimensions({
          renderedWidth: container.clientWidth,
          renderedHeight: container.clientHeight,
          naturalWidth: imgElement.naturalWidth,
          naturalHeight: imgElement.naturalHeight,
        });
      } else {
        // Reset if image or container not ready, or natural dimensions are zero
        setImageRenderDimensions(null);
      }
    };

    if (imgElement) {
      imgElement.addEventListener('load', updateDimensions);
      // If image is already loaded (e.g. from cache), update dimensions
      if (imgElement.complete && imgElement.naturalWidth > 0) {
        updateDimensions();
      }
    }

    let resizeObserver: ResizeObserver | undefined;
    if (container) {
      // Initial dimension update in case image is already loaded and container is ready
      updateDimensions();
      resizeObserver = new ResizeObserver(updateDimensions); // Re-calculate on container resize
      resizeObserver.observe(container);
    }

    return () => {
      if (imgElement) {
        imgElement.removeEventListener('load', updateDimensions);
      }
      if (resizeObserver && container) {
        resizeObserver.unobserve(container);
      }
    };
  }, [websiteScreenshot]); // Re-run when the image src changes

  // Calculate scaled bounding box for the highlighted element
  const scaledHighlightedBoundingBox = useMemo(() => {
    if (!highlightedElement || !imageRenderDimensions || !detectedElements ||
        imageRenderDimensions.naturalWidth === 0 || imageRenderDimensions.naturalHeight === 0 ||
        imageRenderDimensions.renderedWidth === 0 || imageRenderDimensions.renderedHeight === 0) {
      return null;
    }

    const elementToHighlight = detectedElements.find(el => el.id === highlightedElement);
    if (!elementToHighlight?.boundingBox) return null;

    const {
      naturalWidth,
      naturalHeight,
      renderedWidth: containerWidth, // Renamed for clarity within this scope
      renderedHeight: containerHeight // Renamed for clarity
    } = imageRenderDimensions;

    const imgAspectRatio = naturalWidth / naturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;

    let visibleImgWidth, visibleImgHeight;
    if (imgAspectRatio > containerAspectRatio) { // Image is wider than container (letterboxed)
      visibleImgWidth = containerWidth;
      visibleImgHeight = containerWidth / imgAspectRatio;
    } else { // Image is taller than container (pillarboxed)
      visibleImgHeight = containerHeight;
      visibleImgWidth = containerHeight * imgAspectRatio;
    }

    const scale = visibleImgWidth / naturalWidth;
    const offsetX = (containerWidth - visibleImgWidth) / 2;
    const offsetY = (containerHeight - visibleImgHeight) / 2;

    const { x, y, width, height } = elementToHighlight.boundingBox;

    const finalScaledX = Math.round(x * scale); // Removed offsetX
    const finalScaledY = Math.round(y * scale); // Removed offsetY
    const finalScaledWidth = Math.round(width * scale);
    const finalScaledHeight = Math.round(height * scale);

    console.log("[Highlight Debug] Element ID:", elementToHighlight.id);
    console.log("[Highlight Debug] Original BBox:", { x, y, width, height });
    console.log("[Highlight Debug] Natural Dims (Img):", { naturalWidth, naturalHeight });
    console.log("[Highlight Debug] Rendered Dims (Container):", { renderedWidth: containerWidth, renderedHeight: containerHeight });
    console.log("[Highlight Debug] Img Aspect Ratio:", imgAspectRatio);
    console.log("[Highlight Debug] Container Aspect Ratio:", containerAspectRatio);
    console.log("[Highlight Debug] Visible Img Dims:", { visibleImgWidth, visibleImgHeight });
    console.log("[Highlight Debug] Scale Factor:", scale);
    console.log("[Highlight Debug] Offsets:", { offsetX, offsetY });
    console.log("[Highlight Debug] Final Scaled BBox:", { top: finalScaledY, left: finalScaledX, width: finalScaledWidth, height: finalScaledHeight });

    return {
      top: finalScaledY,
      left: finalScaledX,
      width: finalScaledWidth,
      height: finalScaledHeight,
    };
  }, [highlightedElement, imageRenderDimensions, detectedElements]);


  const loadWebsiteMutation = useMutation({
    mutationFn: async (url: string) => {
      setImageRenderDimensions(null); // Reset dimensions when new site is loaded
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
    mutationFn: async (payload?: { name?: string; url?: string; sequence?: DragDropTestStep[]; elements?: DetectedElement[]; status?: string }) => {
      const testData = payload || {
        name: testName || `Test for ${currentUrl || "Untitled"}`,
        url: currentUrl,
        sequence: testSequence,
        elements: detectedElements, // Added elements here
        status: "draft", // Default status or make it configurable
      };
      const res = await apiRequest("POST", "/api/tests", testData);
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "Failed to save test");
      }
      return result; // Assuming backend returns the saved test object including its ID
    },
    onSuccess: (data) => { // data should be the saved test object
      toast({
        title: "Test saved",
        description: "Your test has been saved successfully.",
      });
      setCurrentSavedTestId(data.id); // Store the ID of the saved test
      setTestName(data.name); // Update test name state
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

  // This mutation is for executing saved tests by ID (currently not used by the main execute button)
  const executeSavedTestMutation = useMutation({
    mutationFn: async (testId: string) => {
      const res = await apiRequest("POST", `/api/tests/${testId}/execute`);
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "Failed to execute test for saved test");
      }
      return result;
    },
    onSuccess: (data) => {
      if (data.success && data.testRun?.results?.steps?.length) {
        setPlaybackSteps(data.testRun.results.steps);
        setCurrentPlaybackStepIndex(0);
        setIsExecutingPlayback(true);
        if (data.testRun.results.steps[0]?.screenshot) {
          setWebsiteScreenshot(data.testRun.results.steps[0].screenshot);
        }
        toast({ title: "Saved Test Execution Started", description: "Playing back results..." });
      } else {
        setIsExecutingPlayback(false);
        setCurrentPlaybackStepIndex(null);
        setPlaybackSteps([]);
        toast({ title: "Execution Failed", description: data.error || "No steps returned or execution failed.", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
      toast({ title: "Saved Test Execution Request Failed", description: error.message, variant: "destructive" });
    },
  });

  const executeDirectTestMutation = useMutation({
    mutationFn: async (payload: { url: string, sequence: DragDropTestStep[], elements: DetectedElement[], name?: string }) => {
      const res = await apiRequest("POST", "/api/execute-test-direct", payload);
      // The backend for /api/execute-test-direct should directly return { success: boolean; steps?: StepResult[]; error?: string; duration?: number }
      const result = await res.json();
      if (!res.ok) { // Check if HTTP response itself is not OK
        throw new Error(result.error || "Failed to execute direct test. HTTP error.");
      }
      return result; // This is the data structure: { success, steps, error, duration }
    },
    onSuccess: (data) => { // data is { success, steps, error, duration }
      if (data.success && data.steps?.length) {
        setPlaybackSteps(data.steps);
        setCurrentPlaybackStepIndex(0);
        setIsExecutingPlayback(true);
        if (data.steps[0]?.screenshot) {
          setWebsiteScreenshot(data.steps[0].screenshot);
        }
        toast({ title: "Direct Test Execution Started", description: "Playing back results..." });
      } else {
        setIsExecutingPlayback(false);
        setCurrentPlaybackStepIndex(null);
        setPlaybackSteps([]);
        toast({ title: "Execution Failed", description: data.error || "No steps returned or direct execution failed.", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
      toast({ title: "Direct Execution Request Failed", description: error.message, variant: "destructive" });
    },
  });

  // Playback logic using useEffect
  useEffect(() => {
    if (!isExecutingPlayback || !playbackSteps.length || currentPlaybackStepIndex === null) {
      return;
    }

    const stepIndex = currentPlaybackStepIndex;

    if (stepIndex >= 0 && stepIndex < playbackSteps.length) {
      const currentStep = playbackSteps[stepIndex];
      if (currentStep.screenshot) {
        setWebsiteScreenshot(currentStep.screenshot);
      }
      // Optionally, update other UI elements with currentStep.name, currentStep.details, etc.

      const timer = setTimeout(() => {
        setCurrentPlaybackStepIndex(prevIndex => (prevIndex !== null ? prevIndex + 1 : null));
      }, 1500); // 1.5 seconds delay

      return () => clearTimeout(timer);
    } else if (stepIndex >= playbackSteps.length) {
      // Playback finished
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      // setPlaybackSteps([]); // Keep steps for review until next execution? Or clear.
      toast({
        title: "Playback Complete",
        description: "Finished playing back all test steps.",
      });
      // Optionally, restore the original website screenshot if available
      // if (loadWebsiteMutation.data?.screenshot) {
      //   setWebsiteScreenshot(loadWebsiteMutation.data.screenshot);
      // }
    }
  }, [isExecutingPlayback, currentPlaybackStepIndex, playbackSteps]);


  const handleExecuteTest = () => {
    if (testSequence.length === 0) {
      toast({ title: "Empty Sequence", description: "Please add steps to your test sequence.", variant: "destructive" });
      return;
    }

    // Directly prepare payload for direct execution
    const payload = {
      url: currentUrl,
      sequence: testSequence,
      elements: detectedElements,
      name: testName || `Adhoc Test for ${currentUrl || "Untitled"}`
    };
    executeDirectTestMutation.mutate(payload);
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
          <div className="flex-grow">
            <Label htmlFor="testNameInput" className="block text-sm font-medium text-card-foreground mb-1">Test Name</Label>
            <Input
              id="testNameInput"
              type="text"
              placeholder="Enter test name (e.g., Login Flow)"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              className="mb-3"
            />
            <Label htmlFor="urlInput" className="block text-sm font-medium text-card-foreground mb-1">Website URL to Test</Label>
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
              <div className="flex items-center justify-between mb-2"> {/* Reduced mb */}
                <h3 className="text-lg font-semibold text-card-foreground">Website Preview</h3>
                <div className="flex items-center space-x-2">
                  {(executeDirectTestMutation.isPending || executeSavedTestMutation.isPending) && (
                    <Badge variant="outline" className="text-info border-info">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Executing...
                    </Badge>
                  )}
                  {isExecutingPlayback && (
                     <Badge variant="outline" className="text-primary border-primary">
                      <Play className="h-3 w-3 mr-1" />
                      Playback
                    </Badge>
                  )}
                  {websiteLoaded && !isExecutingPlayback && !executeDirectTestMutation.isPending && !executeSavedTestMutation.isPending && (
                    <Badge variant="secondary" className="bg-success text-success-foreground">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Loaded
                    </Badge>
                  )}
                </div>
              </div>
              {/* Playback Status Text */}
              {isExecutingPlayback && currentPlaybackStepIndex !== null && playbackSteps.length > 0 && playbackSteps[currentPlaybackStepIndex] && (
                <div className="mb-2 text-sm text-muted-foreground text-center p-1 bg-muted rounded-md">
                  Step {currentPlaybackStepIndex + 1}/{playbackSteps.length}: {playbackSteps[currentPlaybackStepIndex].name} - {playbackSteps[currentPlaybackStepIndex].details}
                  {playbackSteps[currentPlaybackStepIndex].status === 'failed' && <span className="text-destructive ml-2">(Failed: {playbackSteps[currentPlaybackStepIndex].error})</span>}
                </div>
              )}
              
              {/* This is the container whose dimensions are used for scaling calculations */}
              <div ref={imageContainerRef} className="flex-1 border-2 border-border rounded-lg overflow-hidden relative bg-muted flex items-center justify-center">
                {(websiteLoaded || isExecutingPlayback) && websiteScreenshot ? (
                  <div className="relative">
                    <img 
                      ref={imageRef}
                      src={websiteScreenshot} 
                      alt={isExecutingPlayback ? "Test step screenshot" : "Website screenshot"}
                      className="block max-w-full max-h-full object-contain"
                    />
                    {/* Element highlighting overlay - shown only when NOT in playback mode to avoid confusion */}
                    {!isExecutingPlayback && scaledHighlightedBoundingBox && (
                      <div 
                        className="absolute border-2 border-destructive bg-destructive/20 pointer-events-none"
                        style={{
                          top: `${scaledHighlightedBoundingBox.top}px`,
                          left: `${scaledHighlightedBoundingBox.left}px`,
                          width: `${scaledHighlightedBoundingBox.width}px`,
                          height: `${scaledHighlightedBoundingBox.height}px`,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Load a website to see the preview</p>
                      <p className="text-sm mt-2">Screenshots from website loading or test playback will appear here.</p>
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
            onExecuteTest={handleExecuteTest}
            onSaveTest={handleSaveTest}
            onClearSequence={handleClearSequence}
            isExecuting={executeDirectTestMutation.isPending || isExecutingPlayback}
            isSaving={saveTestMutation.isPending && !executeDirectTestMutation.isPending && !isExecutingPlayback}
          />
        </div>
      </div>
    </div>
  );
}