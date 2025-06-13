import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "@tanstack/react-query";
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
  User
} from "lucide-react";
import { Link } from "wouter";

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
  const [currentUrl, setCurrentUrl] = useState("https://github.com");
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [testSequence, setTestSequence] = useState<DragDropTestStep[]>([]);
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null);

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <TestTube className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold text-gray-900">WebTest Platform</h1>
            </div>
            
            <nav className="hidden md:flex space-x-6">
              <span className="text-primary font-medium border-b-2 border-primary pb-2">Create Test</span>
              <span className="text-gray-600 hover:text-gray-900 pb-2 cursor-pointer">My Tests</span>
              <span className="text-gray-600 hover:text-gray-900 pb-2 cursor-pointer">Reports</span>
            </nav>
          </div>
          
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon">
              <Bell className="h-4 w-4" />
            </Button>
            <Link href="/settings">
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
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

      {/* URL Input Section */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <Label className="block text-sm font-medium text-gray-700 mb-2">Website URL to Test</Label>
            <div className="flex space-x-3">
              <Input
                type="url"
                className="flex-1"
                placeholder="https://example.com"
                value={currentUrl}
                onChange={(e) => setCurrentUrl(e.target.value)}
              />
              <Button 
                onClick={handleLoadWebsite}
                disabled={loadWebsiteMutation.isPending}
              >
                <Globe className="h-4 w-4 mr-2" />
                {loadWebsiteMutation.isPending ? "Loading..." : "Load Website"}
              </Button>
              <Button 
                onClick={handleDetectElements}
                disabled={detectElementsMutation.isPending || !websiteLoaded}
                variant="secondary"
              >
                <Search className="h-4 w-4 mr-2" />
                {detectElementsMutation.isPending ? "Detecting..." : "Detect Elements"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area - Two-level layout */}
      <div className="flex-1 flex flex-col">
        {/* Top section: Actions, Preview, Elements (60% of viewport) */}
        <div className="flex h-[60vh] border-b border-gray-200">
          {/* Left Sidebar - Actions */}
          <div className="w-80 bg-white border-r border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Actions</h3>
            
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {availableActions.map((action) => (
                  <DraggableAction key={action.id} action={action} />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Center - Website Preview (Prominent and well-visible) */}
          <div className="flex-1 bg-white border-r border-gray-200 p-4">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Website Preview</h3>
                <div className="flex items-center space-x-2">
                  {websiteLoaded && (
                    <Badge variant="secondary" className="bg-success text-white">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Loaded
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="flex-1 border-2 border-gray-300 rounded-lg overflow-hidden relative bg-white">
                {websiteLoaded && websiteScreenshot ? (
                  <div className="w-full h-full overflow-auto bg-white relative">
                    <img 
                      src={websiteScreenshot} 
                      alt="Website screenshot"
                      className="w-full h-auto object-contain"
                      style={{ minHeight: '100%' }}
                    />
                    {/* Element highlighting overlay based on real boundingBox data */}
                    {highlightedElement && detectedElements.find(el => el.id === highlightedElement)?.boundingBox && (
                      <div 
                        className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20 pointer-events-none"
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
                  <div className="flex items-center justify-center h-full text-gray-500">
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
          <div className="w-80 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Detected Elements</h3>
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
                  <div className="flex items-center justify-center h-32 text-gray-500">
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
        <div className="h-[40vh] bg-white p-6">
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