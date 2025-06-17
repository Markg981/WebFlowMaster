import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ArrowLeft, // Add this if not present
} from "lucide-react";
import { Link } from "wouter";
import debounceFromLodash from 'lodash/debounce'; // Attempt to import lodash.debounce

// Interface for actions received from backend recording service
interface BackendRecordedAction {
  type: 'click' | 'input' | 'select' | 'navigate' | 'keypress' | 'assertion';
  selector?: string;
  value?: string;
  timestamp: number;
  url?: string;
  key?: string;
  targetTag?: string;
  targetId?: string;
  targetClass?: string;
  targetText?: string;
  // assertType and assertValue are for assertion actions, map them if you have assertion TestActions
}

// Fallback simple debounce function definition (if lodash is not used/available)
function simpleDebounce<F extends (...args: any[]) => void>(func: F, waitFor: number): F & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debouncedFunc = (...args: Parameters<F>): void => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), waitFor);
  };
  (debouncedFunc as any).cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return debouncedFunc as F & { cancel: () => void };
}

// Helper function to check if a test step is complete enough for real-time execution
// Placed outside the component as it doesn't rely on component state/props directly.
// Assumes DragDropTestStep structure has action.type, targetElement, and value.
function isTestStepComplete(step: DragDropTestStep): boolean {
  if (!step || !step.action || !step.action.type) {
    return false; // Invalid step structure
  }

  const actionType = step.action.type; // Assuming action.type holds the string like 'input', 'click'

  switch (actionType) {
    case 'input':
      // Requires a target element and a non-empty value
      return !!step.targetElement && !!step.value && step.value.trim() !== "";
    case 'select':
      // Requires a target element and a non-empty value
      return !!step.targetElement && !!step.value && step.value.trim() !== "";
    case 'click':
    case 'hover':
    case 'assert': // Basic check for assert, might need more specifics depending on assertion types
      // Require a target element
      return !!step.targetElement;
    case 'wait':
      // Requires a non-empty value (server-side validates if it's numeric)
      return !!step.value && step.value.trim() !== "";
    case 'scroll':
      // Assuming 'scroll' without targetElement means scroll window, which is always "complete"
      // If scroll can target an element and that's a common case, this might need:
      // return step.targetElement ? true : true; // Or more specific checks if target scroll needs validation
      return true;
    default:
      // For actions not explicitly listed, default to false.
      // This ensures any new action type must be explicitly considered here for completeness.
      return false;
  }
}


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

// Exporting TestAction interface for use in other components
export interface TestAction {
  id: string;
  type: string; // This 'type' can be same as 'id' or a broader category like 'assertion'
  name: string;
  icon: string;
  description: string;
}

// Exporting availableActions for use in TestSequenceBuilder and potentially other components
export const availableActions: TestAction[] = [
  { id: "click", type: "click", name: "Click Element", icon: "mouse-pointer", description: "Simulate a mouse click" },
  { id: "input", type: "input", name: "Input Text", icon: "keyboard", description: "Type text into field" },
  { id: "wait", type: "wait", name: "Wait", icon: "clock", description: "Pause execution" },
  { id: "scroll", type: "scroll", name: "Scroll", icon: "scroll", description: "Scroll page or element" },
  // General 'assert' might be kept for simple assertions or removed if specific ones cover all cases
  // For now, specific assertions are preferred. The generic 'assert' might be removed later.
  // { id: "assert", type: "assert", name: "Assert Element", icon: "check-circle", description: "Verify element properties" },
  { id: "hover", type: "hover", name: "Hover", icon: "hand", description: "Hover over element" },
  { id: "select", type: "select", name: "Select Option", icon: "chevron-down", description: "Choose dropdown option" },
  {
    id: "assertTextContains",
    type: "assertTextContains", // Or "assertion" if grouping by broader type
    name: "Assert Text Contains",
    icon: "CheckSquare", // Using CheckSquare from lucide-react (ensure it's imported if not already)
    description: "Checks if an element contains specific text."
  },
  {
    id: "assertElementCount",
    type: "assertElementCount", // Or "assertion"
    name: "Assert Element Count",
    icon: "ListChecks", // Using ListChecks from lucide-react (ensure it's imported if not already)
    description: "Checks how many elements match a selector."
  },
];

export default function DashboardPage() {
  const { user, logoutMutation } = useAuth();
  // Initial URL state. "https://github.com" is a placeholder that can be overwritten.
  const [currentUrl, setCurrentUrl] = useState("https://github.com");
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [testSequence, setTestSequence] = useState<DragDropTestStep[]>([]);
  const [creationMode, setCreationMode] = useState<"manual" | "record">(
    "manual"
  );
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null); // This will now also be used for playback
  const [isInitialUrlPrefilled, setIsInitialUrlPrefilled] = useState(false);

  // States for recording
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

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

  const startRecordingMutation = useMutation({
    mutationFn: async (payload: { url: string }) => {
      const res = await apiRequest("POST", "/api/start-recording", payload);
      // Assuming the backend returns { success: boolean, sessionId?: string, error?: string }
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to start recording session.");
      }
      return result; // Expected: { success: true, sessionId: "some-session-id" }
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setIsRecording(true);
      toast({
        title: "Recording Started",
        description: "User actions are now being recorded.",
      });
      // Polling will be started by useEffect based on isRecording and sessionId
    },
    onError: (error: Error) => {
      setIsRecording(false); // Revert state on error
      // Button states will be managed based on isRecording and mutation pending state
      toast({
        title: "Failed to Start Recording",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleStartRecording = async () => {
    if (!currentUrl || !websiteLoaded) {
      toast({
        title: "Cannot Start Recording",
        description: "Please load a website before starting to record a test.",
        variant: "warning",
      });
      return;
    }
    // Optimistically set isRecording to true to disable button immediately,
    // but rely on onSuccess/onError for actual session ID and final state.
    // setIsRecording(true); // This is handled by the mutation's lifecycle now.
    startRecordingMutation.mutate({ url: currentUrl });
  };

  const stopRecordingMutation = useMutation({
    mutationFn: async (payload: { sessionId: string | null }) => {
      if (!payload.sessionId) {
        throw new Error("No active recording session to stop.");
      }
      const res = await apiRequest("POST", "/api/stop-recording", payload);
      // Backend returns { success: boolean, sequence?: BackendRecordedAction[], error?: string }
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to stop recording session.");
      }
      return result; // Expected { success: true, sequence: BackendRecordedAction[] }
    },
    onSuccess: (data: { sequence?: BackendRecordedAction[] }) => {
      if (data.sequence) {
        const newTestSequence: DragDropTestStep[] = data.sequence.map((recordedAction, index) => {
          const correspondingAction = availableActions.find(a => a.id === recordedAction.type);

          if (!correspondingAction) {
            console.warn(`No available action found for recorded type: ${recordedAction.type}. Skipping.`);
            return null;
          }

          let targetElementPlaceholder: DetectedElement | undefined = undefined;
          if (recordedAction.selector) {
            targetElementPlaceholder = {
              id: `recorded-elem-${Date.now()}-${index}`,
              selector: recordedAction.selector,
              type: recordedAction.targetTag || 'element',
              text: recordedAction.targetText || recordedAction.selector,
              tag: recordedAction.targetTag || 'unknown',
              attributes: {},
            };
          }

          return {
            id: `step-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
            action: correspondingAction,
            targetElement: targetElementPlaceholder,
            value: recordedAction.value || "",
          };
        }).filter(step => step !== null && step.action !== undefined) as DragDropTestStep[];

        setTestSequence(newTestSequence);
        toast({
          title: "Recording Stopped",
          description: `Test sequence updated with ${newTestSequence.length} recorded actions.`,
        });
      } else {
        setTestSequence([]);
        toast({
          title: "Recording Stopped",
          description: "No actions were recorded or returned.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Stop Recording",
        description: error.message,
        variant: "destructive",
      });
    },
    // The malformed onSettled and duplicate onError that followed have been removed.
    onSettled: () => {
      // This block executes after onSuccess or onError
      setIsRecording(false);
      setSessionId(null);
      // Button states are managed by isRecording and mutation pending states
    },
  });

  const handleStopRecording = async () => {
    if (!sessionId) {
      toast({
        title: "Error",
        description: "No recording session is active.",
        variant: "destructive",
      });
      // Ensure states are reset even if sessionId was somehow null
      setIsRecording(false);
      setSessionId(null);
      return;
    }
    stopRecordingMutation.mutate({ sessionId });
  };

  // Function to fetch recorded actions (not a useQuery hook, but a helper for polling)
  const fetchRecordedActions = async (currentSessionId: string | null): Promise<DragDropTestStep[]> => {
    if (!currentSessionId) {
      return [];
    }
    try {
      const res = await apiRequest("GET", `/api/get-recorded-actions?sessionId=${currentSessionId}`);
      const result: { success: boolean, sequence?: BackendRecordedAction[], error?: string } = await res.json();
      if (!res.ok || !result.success) {
        console.error("Polling: Failed to fetch recorded actions:", result.error || "Unknown error");
        return [];
      }

      if (result.sequence) {
        const newTestSequence: DragDropTestStep[] = result.sequence.map((recordedAction, index) => {
          const correspondingAction = availableActions.find(a => a.id === recordedAction.type);
          if (!correspondingAction) {
            console.warn(`Polling: No available action for type: ${recordedAction.type}`);
            return null;
          }

          let targetElementPlaceholder: DetectedElement | undefined = undefined;
          if (recordedAction.selector) {
            targetElementPlaceholder = {
              id: `polled-elem-${Date.now()}-${index}`,
              selector: recordedAction.selector,
              type: recordedAction.targetTag || 'element',
              text: recordedAction.targetText || recordedAction.selector,
              tag: recordedAction.targetTag || 'unknown',
              attributes: {},
            };
          }
          return {
            id: `polled-step-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
            action: correspondingAction,
            targetElement: targetElementPlaceholder,
            value: recordedAction.value || "",
          };
        }).filter(step => step !== null && step.action !== undefined) as DragDropTestStep[];
        return newTestSequence;
      }
      return [];
    } catch (error) {
      console.error("Polling: Error fetching recorded actions:", error);
      return [];
    }
  };

  // useEffect for polling recorded actions
  useEffect(() => {
    let pollingIntervalId: NodeJS.Timeout | null = null;

    if (isRecording && sessionId) {
      pollingIntervalId = setInterval(async () => {
        // console.log(`Polling for actions with sessionId: ${sessionId}`);
        const actionsFromPolling = await fetchRecordedActions(sessionId);

        if (actionsFromPolling.length > 0 || testSequence.length > 0) {
          if (JSON.stringify(actionsFromPolling) !== JSON.stringify(testSequence)) {
            setTestSequence(actionsFromPolling);
          }
        }
      }, 3000);
    } else {
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
    }

    return () => {
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
    };
  }, [isRecording, sessionId, testSequence]); // testSequence is now a dep for comparison

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
    onSuccess: (data) => { // data is { success, steps, error, duration, detectedElements }
      if (data.success && data.steps?.length) {
        setPlaybackSteps(data.steps);
        setCurrentPlaybackStepIndex(0);
        setIsExecutingPlayback(true);
        if (data.steps[0]?.screenshot) {
          setWebsiteScreenshot(data.steps[0].screenshot);
        }
        // New part: Update detected elements
        if (data.detectedElements) {
          setDetectedElements(data.detectedElements);
        } else {
          setDetectedElements([]);
        }
        toast({ title: "Direct Test Execution Started", description: "Playing back results..." });
      } else {
        setIsExecutingPlayback(false);
        setCurrentPlaybackStepIndex(null);
        setPlaybackSteps([]);
        // Potentially also set detectedElements to empty array here if applicable
        if (data.detectedElements) { // Even on failure, backend might send elements
          setDetectedElements(data.detectedElements);
        } else {
          setDetectedElements([]);
        }
        toast({ title: "Execution Failed", description: data.error || "No steps returned or direct execution failed.", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
      setDetectedElements([]); // Clear elements on error
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
    // Optionally, when the sequence is cleared, you might want to re-fetch initial elements
    // if (currentUrl && websiteLoaded) {
    //   handleDetectElements();
    // } else {
    //   setDetectedElements([]);
    // }
    // For now, just clearing the sequence state. The handleSequenceUpdated will manage effects.
  };

  // New function to handle sequence updates and trigger real-time execution

  const debouncedExecuteMutation = useMemo(() => {
    const actualDebounce = typeof debounceFromLodash === 'function' ? debounceFromLodash : simpleDebounce;
    return actualDebounce((payload: { url: string, sequence: DragDropTestStep[], elements: DetectedElement[], name?: string }) => {
      // Condition for execution is checked here, inside the debounced function,
      // to ensure it's evaluated at the moment of potential execution, not when debouncing starts.
      if (!executeDirectTestMutation.isPending && !isExecutingPlayback) {
        executeDirectTestMutation.mutate(payload);
      }
    }, 750); // 750ms debounce delay
  }, [executeDirectTestMutation.isPending, isExecutingPlayback, executeDirectTestMutation.mutate]); // Add dependencies for the mutation status

  const handleSequenceUpdated = (newSequence: DragDropTestStep[]) => {
    setTestSequence(newSequence);

    const allStepsComplete = newSequence.every(isTestStepComplete);

    if (newSequence.length > 0 && allStepsComplete && currentUrl && websiteLoaded) {
      // Conditions for debounced execution (isPending, isExecutingPlayback) are checked inside debouncedExecuteMutation
      const payload = {
        url: currentUrl,
        sequence: newSequence,
        elements: detectedElements, // Pass current elements as context
        name: testName || `Realtime Preview for ${currentUrl || "Untitled"}`
      };
      debouncedExecuteMutation(payload);
    } else if (newSequence.length === 0) {
      // If sequence is cleared, cancel any pending debounced execution
      if (typeof debouncedExecuteMutation.cancel === 'function') {
        debouncedExecuteMutation.cancel();
      }
      // Also, if sequence is cleared, and a URL is loaded, re-detect elements for the base page.
      // This resets the element list to the state of the page before any actions.
      if (currentUrl && websiteLoaded) {
        // handleDetectElements(); // This would fetch fresh elements.
        // For now, let's clear detected elements or leave them as is.
        // setDetectedElements([]);
      }
       // If the sequence is empty, ensure playback stops and clears.
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
      // Potentially clear the screenshot or revert to initial loaded screenshot
      // if (loadWebsiteMutation.data?.screenshot) {
      //  setWebsiteScreenshot(loadWebsiteMutation.data.screenshot);
      // }
    } else if (newSequence.length > 0 && !allStepsComplete) {
      // Sequence is not empty but not all steps are complete.
      // Cancel any pending debounced execution because the current sequence isn't fully valid for preview.
      if (typeof debouncedExecuteMutation.cancel === 'function') {
        debouncedExecuteMutation.cancel();
      }
      console.log("Real-time execution skipped: Not all test steps are complete.");
      // Optionally, provide feedback to the user here (e.g., via a toast or UI indicator)
    }
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

      {/* Back to Dashboard Button Section */}
      <div className="px-6 pt-4 bg-card border-b border-border">
        <div className="mb-4">
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back To Dashboard
            </Button>
          </Link>
        </div>
      </div>

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
                disabled={isRecording || startRecordingMutation.isPending}
              />
              <Button
                onClick={handleLoadWebsite}
                disabled={loadWebsiteMutation.isPending || isLoadingUserSettings || isRecording || startRecordingMutation.isPending}
              >
                {loadWebsiteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                {loadWebsiteMutation.isPending ? "Loading..." : "Load Website"}
              </Button>
              {creationMode === 'manual' && (
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
              )}
            </div>
            <div className="mt-4">
              <Label htmlFor="creationModeSelect" className="block text-sm font-medium text-card-foreground mb-1">Modalità di Creazione Test</Label>
              <Select value={creationMode} onValueChange={(value: "manual" | "record") => setCreationMode(value)}>
                <SelectTrigger id="creationModeSelect" className="w-[280px]">
                  <SelectValue placeholder="Seleziona modalità" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Crea test manuale (drag & drop)</SelectItem>
                  <SelectItem value="record">Registra azioni utente (auto-record)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {creationMode === 'record' && (
              <div className="mt-4 flex space-x-3">
                <Button
                  onClick={handleStartRecording}
                  variant="outline"
                  disabled={isRecording || startRecordingMutation.isPending || !websiteLoaded}
                >
                  {startRecordingMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {startRecordingMutation.isPending ? "Starting..." : "Inizia registrazione"}
                </Button>
                <Button
                  onClick={handleStopRecording}
                  variant="outline"
                  disabled={!isRecording || stopRecordingMutation.isPending}
                >
                  {stopRecordingMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <StopCircle className="h-4 w-4 mr-2" />
                  )}
                  {stopRecordingMutation.isPending ? "Stopping..." : "Termina registrazione"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area - Two-level layout */}
      <div className="flex-1 flex flex-col">
        {/* Top section: Actions, Preview, Elements (60% of viewport) */}
        <div className="flex h-[60vh] border-b border-border">
          {/* Left Sidebar - Actions */}
          {creationMode === 'manual' && (
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
          )}

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
          {creationMode === 'manual' && (
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
          )}
          {/* If creationMode is 'record', the Detected Elements sidebar might be hidden or replaced */}
          {/* For now, it's just hidden. Future tasks might define what shows here in 'record' mode. */}
        </div>

        {/* Bottom section: Test Sequence Builder (40% of viewport) */}
        <div className="h-[40vh] bg-card p-6"> {/* Changed bg-white to bg-card */}
          <TestSequenceBuilder
            testSequence={testSequence}
            onUpdateSequence={handleSequenceUpdated}
            onExecuteTest={handleExecuteTest}
            onSaveTest={handleSaveTest}
            onClearSequence={handleClearSequence}
            isExecuting={executeDirectTestMutation.isPending || isExecutingPlayback}
            isSaving={saveTestMutation.isPending && !executeDirectTestMutation.isPending && !isExecutingPlayback}
            isRecordingActive={isRecording} // Pass the isRecording state
          />
        </div>
      </div>
    </div>
  );
}