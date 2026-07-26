import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { VisualTestBuilder } from "@/components/visual-builder/VisualTestBuilder";
import { TestStep as DragDropTestStep } from "@/components/drag-drop-provider";
import SaveTestModal from "@/components/SaveTestModal"; // Import the modal
import { PreconditionsPanel } from "@/components/PreconditionsPanel";
import type { Precondition } from "@shared/schema";
import { ACTION_I18N, ADHOC_ACTION_IDS } from "@shared/recording";
import { useRecordingSession } from "@/hooks/useRecordingSession";
import {
  Globe,
  Search,
  CheckCircle,
  Loader2,
  Play,
  StopCircle, // Add this if not present
  Info,
  XCircle, // Added this icon
} from "lucide-react";
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

/**
 * The action palette, derived from the shared action table so the manual builder and the
 * recorder can never drift apart — a recorded action always has a palette entry to map to.
 */
export const availableActions: TestAction[] = ADHOC_ACTION_IDS.map((id) => ({
  id,
  type: id,
  name: ACTION_I18N[id].name,
  icon: ACTION_I18N[id].icon,
  description: ACTION_I18N[id].description,
}));

export default function DashboardPage() {
  const { t } = useTranslation();
  // Initial URL state. "https://github.com" is a placeholder that can be overwritten.
  const [currentUrl, setCurrentUrl] = useState("https://github.com");
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [testSequence, setTestSequence] = useState<DragDropTestStep[]>([]);
  const [preconditions, setPreconditions] = useState<Precondition[]>([]);
  const [creationMode, setCreationMode] = useState<"manual" | "record">(
    "manual"
  );
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null); // This will now also be used for playback
  const [isInitialUrlPrefilled, setIsInitialUrlPrefilled] = useState(false);

  // States for test execution playback
  const [isExecutingPlayback, setIsExecutingPlayback] = useState(false);
  const [currentPlaybackStepIndex, setCurrentPlaybackStepIndex] = useState<number | null>(null);
  const [playbackSteps, setPlaybackSteps] = useState<StepResult[]>([]);
  const [_currentSavedTestId, setCurrentSavedTestId] = useState<string | null>(null); // To store ID of saved/loaded test
  const [testName, setTestName] = useState<string>(""); // To store test name
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [lastTestOverallResult, setLastTestOverallResult] = useState<boolean | null>(null);


  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null); // Ref for the div that provides dimensions for scaling
  const [imageRenderDimensions, setImageRenderDimensions] = useState<{
    renderedWidth: number; // Width of the container where image is rendered (imageContainerRef.clientWidth)
    renderedHeight: number; // Height of the container where image is rendered (imageContainerRef.clientHeight)
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);


  // Can this server open the visible browser window a recording needs? Undefined until the
  // check resolves, so the UI never flashes a false warning.
  const { data: recordingCapability } = useQuery<{ supported: boolean }, Error>({
    queryKey: ["recordingCapability"],
    queryFn: async () => {
      const res = await fetch("/api/recording-capability");
      if (!res.ok) throw new Error("Failed to check recording capability");
      return res.json();
    },
    staleTime: Infinity,
  });
  const recordingSupported = recordingCapability?.supported;

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
    else if (settingsData && !settingsData.defaultTestUrl && currentUrl === "https://github.com" && !isInitialUrlPrefilled) {
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

    // object-contain: the image is scaled to fit, so the rendered width is the container
    // width when the image is the wider of the two, and derived from the height otherwise.
    const visibleImgWidth = imgAspectRatio > containerAspectRatio
      ? containerWidth
      : containerHeight * imgAspectRatio;

    // The overlay is positioned against the <img>, not the container, so the letterbox
    // offsets are already absorbed by the image's own box and must not be added here.
    const scale = visibleImgWidth / naturalWidth;
    const { x, y, width, height } = elementToHighlight.boundingBox;

    const finalScaledX = Math.round(x * scale);
    const finalScaledY = Math.round(y * scale);
    const finalScaledWidth = Math.round(width * scale);
    const finalScaledHeight = Math.round(height * scale);

    return {
      top: finalScaledY,
      left: finalScaledX,
      width: finalScaledWidth,
      height: finalScaledHeight,
    };
  }, [highlightedElement, imageRenderDimensions, detectedElements]);


  const loadWebsiteMutation = useMutation({
    mutationFn: async (passedUrl: string) => { // Renamed 'url' to 'passedUrl'
      try {
        setImageRenderDimensions(null); // Reset dimensions when new site is loaded

        const websiteUrl = String(passedUrl || ''); // Ensure it's a string
        if (!websiteUrl) {
          // This case should ideally be caught by UI validation before calling mutate
          console.error("loadWebsiteMutation: Website URL is empty or invalid.");
          throw new Error("Website URL is empty or invalid.");
        }

        const payload = { url: websiteUrl };

        const res = await apiRequest("POST", "/api/load-website", payload);

        // Check if response is ok before trying to parse JSON
        if (!res.ok) {
          let errorBody = "Unknown error";
          try {
            errorBody = await res.text(); // Try to get text first, might not be JSON
            const parsedError = JSON.parse(errorBody); // Try to parse as JSON
            if (parsedError && parsedError.error) {
              errorBody = parsedError.error;
            }
          } catch (e) {
            // If JSON.parse fails or res.text() fails, errorBody remains as is or default
            console.warn("Could not parse error response as JSON, using text body.", e);
          }
          console.error(`Error from /api/load-website: ${res.status} ${res.statusText}`, errorBody);
          throw new Error(errorBody || `Failed to load website. Status: ${res.status}`);
        }

        const jsonData = await res.json();
        return jsonData;

      } catch (error) {
        console.error("Critical error directly within loadWebsiteMutation mutationFn:", error);
        // Re-throw the error so TanStack Query's onError handler can pick it up
        // and UI state (like isPending) is correctly managed.
        throw error;
      }
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
    mutationFn: async (payload: { name: string; url: string; sequence: DragDropTestStep[]; elements: DetectedElement[]; status: string; projectId?: number; preconditions?: Precondition[] }) => {
      // No default payload here, it's fully constructed in handleConfirmSaveTest
      const res = await apiRequest("POST", "/api/tests", payload);
      // apiRequest should handle non-ok responses by throwing an error.
      // It should also parse JSON response.
      return res; // Assuming apiRequest returns parsed JSON directly
    },
    onSuccess: (data: any) => { // data should be the saved test object
      toast({
        title: "Test saved",
        description: "Your test has been saved successfully.",
      });
      setCurrentSavedTestId(data.id); // Store the ID of the saved test
      setTestName(data.name); // Update test name state
      setIsSaveModalOpen(false); // Close the modal on successful save
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
    // saveTestMutation.mutate(); // This will be moved to the modal
    handleOpenSaveModal();
  };

  const handleOpenSaveModal = () => {
    setIsSaveModalOpen(true);
  };

  const handleCloseSaveModal = () => {
    setIsSaveModalOpen(false);
  };

  // Updated to accept projectId
  const handleConfirmSaveTest = (newName: string, projectId?: number) => {
    setTestName(newName); // Update the main page's testName state
    if (!projectId) {
      toast({
        title: "Project Not Selected",
        description: "Please select a project to save the test.",
        variant: "destructive",
      });
      // Re-open modal or indicate error. For now, just preventing save.
      // Re-opening modal might be better UX, but requires passing modal control back or more complex state.
      // For now, the modal itself prevents saving without a project. This handler expects it if called.
      console.error("Save attempt without projectId, this should be prevented by modal");
      return;
    }
    saveTestMutation.mutate({
      name: newName,
      projectId: projectId, // Pass projectId here
      url: currentUrl,
      sequence: testSequence,
      elements: detectedElements,
      preconditions,
      status: "draft",
    });
    // Modal is closed by the SaveTestModal itself after its onSave is called if save is successful.
    // Or, if you want this function to control it: handleCloseSaveModal();
  };

  // The whole record -> poll -> stop lifecycle lives in this hook; the page only reacts to
  // the steps it produces.
  const recording = useRecordingSession({
    onStepsChange: (steps) => setTestSequence(steps as DragDropTestStep[]),
    onError: (titleKey, description) =>
      toast({ title: t(titleKey), description, variant: "destructive" }),
    onNotice: (titleKey, description) =>
      toast({ title: t(titleKey), description, duration: 7000 }),
  });
  const isRecording = recording.isRecording;

  const handleStartRecording = () => {
    if (!currentUrl) {
      toast({
        title: t('dashboardPageNew.toasts.cannotStartRecording.title'),
        description: t('dashboardPageNew.toasts.cannotStartRecording.description'),
        variant: "destructive",
      });
      return;
    }
    if (testSequence.length > 0 && !window.confirm(t('recording.overwriteConfirm'))) {
      return;
    }
    setLastTestOverallResult(null);
    recording.start(currentUrl);
    toast({
      title: t('dashboardPageNew.toasts.recordingStarted.title'),
      description: t('dashboardPageNew.toasts.recordingStarted.description'),
      duration: 7000,
    });
  };

  const handleStopRecording = () => {
    recording.stop();
  };

  const executeDirectTestMutation = useMutation({
    mutationFn: async (payload: { url: string, sequence: DragDropTestStep[], elements: DetectedElement[], name?: string, preconditions?: Precondition[] }) => {
      const res = await apiRequest("POST", "/api/execute-test-direct", payload);
      // The backend for /api/execute-test-direct should directly return { success: boolean; steps?: StepResult[]; error?: string; duration?: number }
      const result = await res.json();
      if (!res.ok) { // Check if HTTP response itself is not OK
        throw new Error(result.error || "Failed to execute direct test. HTTP error.");
      }
      return result; // This is the data structure: { success, steps, error, duration }
    },
    onSuccess: (data) => { // data is { success, steps, error, duration, detectedElements }
      // Always handle detectedElements first
      if (data.detectedElements) {
        setDetectedElements(data.detectedElements);
      } else {
        setDetectedElements([]);
      }


      if (data.success && data.steps?.length) {
        setLastTestOverallResult(data.success); // Store overall test result
        setPlaybackSteps(data.steps);
        setCurrentPlaybackStepIndex(0);
        setIsExecutingPlayback(true);
        if (data.steps[0]?.screenshot) {
          setWebsiteScreenshot(data.steps[data.steps.length - 1].screenshot);
        }
        toast({
          title: t('dashboardPageNew.toasts.directExecutionStarted.title'),
          description: t('dashboardPageNew.toasts.directExecutionStarted.description')
        });
      } else {
        // This block handles cases where data.success is false or data.steps is empty
        setIsExecutingPlayback(false);
        setCurrentPlaybackStepIndex(null);
        setPlaybackSteps([]);
        setLastTestOverallResult(data.success !== undefined ? data.success : false); // Set overall result to failed or actual success value
        toast({
          title: data.success ? t('dashboardPageNew.toasts.executionNote') : t('dashboardPageNew.toasts.testFailed'),
          description: data.error || (data.success ? t('dashboardPageNew.toasts.noStepsToPlayback') : t('dashboardPageNew.toasts.executionFailed')),
          variant: data.success ? "default" : "destructive"
        });
      }
    },
    onSettled: () => {
      // This block ensures that regardless of success or error,
      // if playback isn't supposed to be active, it's turned off.
      // Note: isExecutingPlayback is true only if data.success and data.steps exist.
      // If the mutation fails or returns no steps, isExecutingPlayback should be false.
      // This check is a safeguard.
      if (!(executeDirectTestMutation.data?.success && executeDirectTestMutation.data?.steps?.length)) {
        setIsExecutingPlayback(false);
      }
    },
    onError: (error: Error) => {
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
      setDetectedElements([]); // Clear elements on error
      setLastTestOverallResult(false); // Set overall result to failed
      toast({ title: t('dashboardPageNew.toasts.testFailed'), description: error.message, variant: "destructive" });
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
      if (lastTestOverallResult === true) {
        toast({
          title: t('dashboardPageNew.toasts.testPassed'),
          description: t('dashboardPageNew.testResultPassed.text'),
        });
      } else if (lastTestOverallResult === false) {
        toast({
          title: t('dashboardPageNew.toasts.testFailed'),
          description: t('dashboardPageNew.testResultFailed.text'),
          variant: "destructive",
        });
      } else {
        // This case should ideally not be reached if lastTestOverallResult is always set before playback
        toast({
          title: t('dashboardPageNew.toasts.playbackComplete.title'),
          description: t('dashboardPageNew.toasts.playbackComplete.description'),
          variant: "default",
        });
      }
      // Optionally, restore the original website screenshot if available
      // if (loadWebsiteMutation.data?.screenshot) {
      //   setWebsiteScreenshot(loadWebsiteMutation.data.screenshot);
      // }
    }
    // Playback-completion effect; lastTestOverallResult is set before playback starts and
    // read here by design, and `t` is stable. Re-running on those would double-fire toasts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutingPlayback, currentPlaybackStepIndex, playbackSteps]);


  const handleExecuteTest = () => {
    setLastTestOverallResult(null); // Reset overall result before new execution
    if (testSequence.length === 0) {
      toast({
        title: t('dashboardPageNew.toasts.emptySequence.title'),
        description: t('dashboardPageNew.toasts.emptySequence.description'),
        variant: "destructive"
      });
      return;
    }

    // Directly prepare payload for direct execution
    const payload = {
      url: currentUrl,
      sequence: testSequence,
      elements: detectedElements,
      // Sent so the preview runs the same setup calls as a scheduled run would.
      preconditions,
      name: testName || t('dashboardPageNew.toasts.adhocTestName', { url: currentUrl || t('dashboardPageNew.toasts.untitled') })
    };
    executeDirectTestMutation.mutate(payload);
  };

  const handleClearSequence = () => {
    setTestSequence([]);
    setLastTestOverallResult(null); // Reset overall result
    // Optionally, when the sequence is cleared, you might want to re-fetch initial elements
    // if (currentUrl && websiteLoaded) {
    //   handleDetectElements();
    // } else {
    //   setDetectedElements([]);
    // }
    // For now, just clearing the sequence state. The handleSequenceUpdated will manage effects.
  };

  // Tests run ONLY when the user clicks "Execute Test". Editing the sequence — adding an
  // action or binding a target element — must never launch a run on its own.
  const handleSequenceUpdated = (newSequence: DragDropTestStep[]) => {
    setTestSequence(newSequence);

    // If the sequence was cleared, make sure any in-progress playback stops and resets.
    if (newSequence.length === 0) {
      setIsExecutingPlayback(false);
      setCurrentPlaybackStepIndex(null);
      setPlaybackSteps([]);
    }
  };

  return (
    <div className="min-h-full bg-background text-foreground">
      {/* Page header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('dashboardPageNew.eyebrow', 'Author a UI test')}
        </div>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-card-foreground">
          {t('dashboardPageNew.createWebTest.title')}
        </h1>
      </header>

      {/* URL Input Section */}
      <div className="bg-card border-b border-border px-6 py-4 relative z-40">
        <div className="flex items-center space-x-4">
          <div className="flex-grow">
            <Label htmlFor="urlInput" className="block text-sm font-medium text-card-foreground mb-1">{t('dashboardPageNew.websiteUrlToTest.label')}</Label>
            <div className="flex space-x-3">
              <Input
                id="urlInput"
                type="url"
                className="flex-1"
                placeholder={t('dashboardPageNew.httpsexamplecom.placeholder')}
                value={currentUrl}
                onChange={(e) => {
                  setCurrentUrl(e.target.value);
                  setLastTestOverallResult(null); // Reset on URL change
                  setWebsiteLoaded(false); // Also reset website loaded status
                  setWebsiteScreenshot(null);
                  setDetectedElements([]);
                  setPlaybackSteps([]); // Clear previous playback steps
                  setIsExecutingPlayback(false); // Stop any ongoing playback
                }}
                disabled={isRecording || recording.isStarting}
              />
              <Button
                onClick={handleLoadWebsite}
                disabled={loadWebsiteMutation.isPending || isLoadingUserSettings || isRecording || recording.isStarting}
              >
                {loadWebsiteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                {loadWebsiteMutation.isPending ? t('apiTesterPage.loading.button') : t('dashboardPageNew.loadWebsite.button')}
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
                  {detectElementsMutation.isPending ? t('apiTesterPage.loading.button') : t('dashboardPageNew.detectElements.button')}
                </Button>
              )}
            </div>
            <div className="mt-4">
              <Label htmlFor="creationModeSelect" className="block text-sm font-medium text-card-foreground mb-1">{t('dashboardPageNew.modalitDiCreazioneTest.label')}</Label>
              <Select value={creationMode} onValueChange={(value: "manual" | "record") => setCreationMode(value)}>
                <SelectTrigger id="creationModeSelect" className="w-[280px]">
                  <SelectValue placeholder={t('dashboardPageNew.selezionaModalit.placeholder')} />
                </SelectTrigger>
                <SelectContent className="z-50 bg-background opacity-100 shadow-2xl border-2">
                  <SelectItem value="manual">{t('dashboardPageNew.creaTestManualeDragDrop.text')}</SelectItem>
                  <SelectItem value="record">{t('dashboardPageNew.registraAzioniUtenteAutorecord.text')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {creationMode === 'record' && (
              <div className="mt-4 space-y-3">
                {/* Recording drives a real browser window opened by the server process, so
                    it only works when that process runs on the user's own machine. */}
                <div
                  className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                    recordingSupported === false
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'border-border bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {recordingSupported === false
                      ? t('recording.unavailableOnServer')
                      : t('recording.opensOnServerMachine')}
                  </span>
                </div>
                <div className="flex space-x-3">
                <Button
                  onClick={handleStartRecording}
                  variant="outline"
                  disabled={isRecording || recording.isStarting || !currentUrl || recordingSupported === false}
                >
                  {recording.isStarting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {recording.isStarting ? t('dashboardPageNew.starting.button') : t('dashboardPageNew.iniziaRegistrazione.button')}
                </Button>
                <Button
                  onClick={handleStopRecording}
                  variant="outline"
                  disabled={!isRecording || recording.isStopping}
                >
                  {recording.isStopping ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <StopCircle className="h-4 w-4 mr-2" />
                  )}
                  {recording.isStopping ? t('dashboardPageNew.stopping.button') : t('dashboardPageNew.terminaRegistrazione.button')}
                </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overall Test Result Display — semantic tokens so it stays readable in dark mode */}
      {lastTestOverallResult !== null && (
        <div className="px-6 py-4">
          {lastTestOverallResult === true && (
            <div className="p-3 rounded-md border border-success/40 bg-success/10 text-success">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 mr-2" />
                <span className="font-semibold">{t('dashboardPageNew.testResultPassed.text')}</span>
              </div>
            </div>
          )}
          {lastTestOverallResult === false && (
            <div className="p-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive">
              <div className="flex items-center">
                <XCircle className="h-5 w-5 mr-2" />
                <span className="font-semibold">{t('dashboardPageNew.testResultFailed.text')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area - Two-level layout */}
      <div className="flex-1 flex flex-col relative z-0">
        {/* Top section: Actions, Preview, Elements (60% of viewport) */}
        <div className="flex h-[60vh] border-b border-border">
          {/* Left Sidebar - Actions */}
          {creationMode === 'manual' && (
            <div className="w-80 bg-card border-r border-border p-4 relative">
              <h3 className="text-lg font-semibold text-card-foreground mb-4">{t('dashboardPageNew.availableActions.title')}</h3>

              <ScrollArea className="h-full">
                <div className="space-y-2">
                  {availableActions.map((action) => (
                    <DraggableAction key={action.id} action={action} stepId="library" onDropElement={() => { }} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Center - Website Preview (Prominent and well-visible) */}
          <div className="flex-1 bg-card border-r border-border p-4">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-2"> {/* Reduced mb */}
                <h3 className="text-lg font-semibold text-card-foreground">{t('dashboardPageNew.websitePreview.title')}</h3>
                <div className="flex items-center space-x-2">
                  {(executeDirectTestMutation.isPending) && (
                    <Badge variant="outline" className="text-info border-info">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      {t('dashboardPageNew.executing.text')}
                    </Badge>
                  )}
                  {isExecutingPlayback && (
                    <Badge variant="outline" className="text-primary border-primary">
                      <Play className="h-3 w-3 mr-1" />
                      {t('dashboardPageNew.playback.text')}
                    </Badge>
                  )}
                  {websiteLoaded && !isExecutingPlayback && !executeDirectTestMutation.isPending && (
                    <Badge variant="secondary" className="bg-success text-success-foreground">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {t('dashboardPageNew.loaded.text')}
                    </Badge>
                  )}
                </div>
              </div>
              {/* Playback Status Text */}
              {isExecutingPlayback && currentPlaybackStepIndex !== null && playbackSteps.length > 0 && playbackSteps[currentPlaybackStepIndex] && (
                <div className="mb-2 text-sm text-muted-foreground text-center p-1 bg-muted rounded-md">
                  {t('dashboardPageNew.playbackStatus', {
                    current: currentPlaybackStepIndex + 1,
                    total: playbackSteps.length,
                    name: playbackSteps[currentPlaybackStepIndex].name,
                    details: playbackSteps[currentPlaybackStepIndex].details
                  })}
                  {playbackSteps[currentPlaybackStepIndex].status === 'failed' && (
                    <span className="text-destructive ml-2">
                      {t('dashboardPageNew.playbackFailed', { error: playbackSteps[currentPlaybackStepIndex].error })}
                    </span>
                  )}
                </div>
              )}

              {/* This is the container whose dimensions are used for scaling calculations */}
              <div ref={imageContainerRef} className="flex-1 border-2 border-border rounded-lg overflow-hidden relative bg-muted flex items-center justify-center">
                {creationMode === 'record' && isRecording ? (
                  <div className="h-full w-full flex flex-col p-4 text-left">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                      </span>
                      <p className="font-semibold text-foreground">{t('dashboardPageNew.registrazioneInCorso.text')}</p>
                      <Badge variant="secondary" className="ml-auto">
                        {t('recording.capturedCount', { count: recording.recordedActions.filter(a => !a.meta).length })}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('dashboardPageNew.utilizzaLaFinestraDelBrowser.description')}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">
                      {t('recording.assertHint')}
                    </p>
                    <ScrollArea className="flex-1 rounded-md border border-border bg-background/60">
                      <ol className="p-2 space-y-1">
                        {recording.recordedActions.filter(a => !a.meta).map((action, index) => (
                          <li
                            key={`${action.timestamp}-${index}`}
                            className="flex items-start gap-2 rounded px-2 py-1 text-xs"
                          >
                            <span className="text-muted-foreground tabular-nums w-5 shrink-0">{index + 1}.</span>
                            <span className="font-medium shrink-0">{action.type}</span>
                            <span className="font-mono text-[11px] text-muted-foreground truncate">
                              {action.selector ?? action.url ?? ''}
                            </span>
                            {action.value ? (
                              <span className="ml-auto shrink-0 max-w-[35%] truncate text-muted-foreground">
                                {action.masked ? '••••••' : action.value}
                              </span>
                            ) : null}
                          </li>
                        ))}
                        {recording.recordedActions.filter(a => !a.meta).length === 0 && (
                          <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                            {t('recording.waitingForActions')}
                          </li>
                        )}
                      </ol>
                    </ScrollArea>
                  </div>
                ) : (websiteLoaded || isExecutingPlayback) && websiteScreenshot ? (
                  <div className="relative">
                    <img
                      ref={imageRef}
                      src={websiteScreenshot}
                      alt={isExecutingPlayback ? t('dashboardPageNew.testStepScreenshot.text') : t('dashboardPageNew.websiteScreenshot.text')}
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
                      <p>{t('dashboardPageNew.loadAWebsiteToSeeThe.description')}</p>
                      <p className="text-sm mt-2">{t('dashboardPageNew.screenshotsFromWebsiteLoadingOr.description')}</p>
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
                <h3 className="text-lg font-semibold text-card-foreground">{t('dashboardPageNew.detectedElements.title')}</h3>
                <Badge variant="secondary">{detectedElements.length} {t('dashboardPageNew.found.text')}</Badge>
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
                        <p className="text-sm">{t('dashboardPageNew.noElementsDetectedYet.text')}</p>
                        <p className="text-xs">{t('dashboardPageNew.loadAWebsiteAndClickDetect.description')}</p>
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
          <VisualTestBuilder
            testSequence={testSequence}
            onUpdateSequence={handleSequenceUpdated}
            onExecuteTest={handleExecuteTest}
            onSaveTest={handleSaveTest}
            onClearSequence={handleClearSequence}
            isExecuting={executeDirectTestMutation.isPending || isExecutingPlayback}
            isSaving={saveTestMutation.isPending && !executeDirectTestMutation.isPending && !isExecutingPlayback}
            isRecordingActive={isRecording} // Pass the isRecording state
            lastTestOutcome={lastTestOverallResult} // Pass the test outcome state
          />
        </div>
      </div>
      <div className="px-4 pb-4">
        <PreconditionsPanel preconditions={preconditions} onChange={setPreconditions} />
      </div>
      <SaveTestModal
        isOpen={isSaveModalOpen}
        onClose={handleCloseSaveModal}
        onSave={handleConfirmSaveTest}
        initialTestName={testName}
      />
    </div>
  );
}