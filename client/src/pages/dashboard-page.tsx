import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { 
  TestTube, 
  Globe, 
  Search, 
  MousePointer, 
  Keyboard, 
  Clock, 
  Scroll, 
  CheckCircle, 
  Hand, 
  ChevronDown, 
  Play, 
  Save, 
  Trash2,
  Settings,
  Bell,
  User
} from "lucide-react";

interface DetectedElement {
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
}

interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

interface TestStep {
  id: string;
  action: TestAction;
  element?: DetectedElement;
  value?: string;
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
  const [testSequence, setTestSequence] = useState<TestStep[]>([]);
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const [websiteLoaded, setWebsiteLoaded] = useState(false);

  const loadWebsiteMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/load-website", { url });
      return res.json();
    },
    onSuccess: () => {
      setWebsiteLoaded(true);
      toast({
        title: "Website loaded",
        description: "Website loaded successfully in preview",
      });
    },
    onError: (error: Error) => {
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

  const renderActionIcon = (iconName: string) => {
    const iconProps = { className: "h-4 w-4" };
    switch (iconName) {
      case "mouse-pointer": return <MousePointer {...iconProps} />;
      case "keyboard": return <Keyboard {...iconProps} />;
      case "clock": return <Clock {...iconProps} />;
      case "scroll": return <Scroll {...iconProps} />;
      case "check-circle": return <CheckCircle {...iconProps} />;
      case "hand": return <Hand {...iconProps} />;
      case "chevron-down": return <ChevronDown {...iconProps} />;
      default: return <MousePointer {...iconProps} />;
    }
  };

  const renderElementIcon = (type: string) => {
    const iconProps = { className: "h-4 w-4 text-gray-500" };
    switch (type) {
      case "input": return <Search {...iconProps} />;
      case "button": return <MousePointer {...iconProps} />;
      case "heading": return <span className="text-gray-500 font-bold text-sm">H</span>;
      default: return <MousePointer {...iconProps} />;
    }
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
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
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

      {/* Main Content Area */}
      <div className="flex h-[calc(100vh-200px)]">
        {/* Left Sidebar - Actions */}
        <div className="w-80 bg-white border-r border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Actions</h3>
          
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {availableActions.map((action) => (
                <Card 
                  key={action.id}
                  className="p-3 cursor-move hover:border-accent hover:bg-orange-50 transition-colors border-dashed"
                  draggable
                >
                  <div className="flex items-center space-x-3">
                    {renderActionIcon(action.icon)}
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{action.name}</div>
                      <div className="text-xs text-gray-500">{action.description}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Center - Website Preview */}
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
              {websiteLoaded ? (
                <div className="w-full h-full overflow-auto bg-white">
                  {/* GitHub homepage mockup */}
                  <div className="bg-gray-900 text-white p-4 border-b border-gray-700">
                    <div className="flex items-center justify-between max-w-6xl mx-auto">
                      <div className="flex items-center space-x-4">
                        <TestTube className="h-6 w-6" />
                        <span className="font-bold text-xl">GitHub</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <Input
                          placeholder="Search GitHub"
                          className="px-3 py-1 bg-gray-800 border-gray-600 text-white"
                          data-element-id="search-input"
                          style={{
                            outline: highlightedElement === "search-input" ? "2px solid #f44336" : "none",
                            outlineOffset: highlightedElement === "search-input" ? "2px" : "0"
                          }}
                        />
                        <Button 
                          size="sm" 
                          className="bg-blue-600 hover:bg-blue-700"
                          data-element-id="sign-in-btn"
                          style={{
                            outline: highlightedElement === "sign-in-btn" ? "2px solid #f44336" : "none",
                            outlineOffset: highlightedElement === "sign-in-btn" ? "2px" : "0"
                          }}
                        >
                          Sign in
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-b from-purple-900 to-gray-900 text-white p-12">
                    <div className="max-w-4xl mx-auto text-center">
                      <h1 
                        className="text-5xl font-bold mb-6"
                        data-element-id="hero-title"
                        style={{
                          outline: highlightedElement === "hero-title" ? "2px solid #f44336" : "none",
                          outlineOffset: highlightedElement === "hero-title" ? "2px" : "0"
                        }}
                      >
                        Let's build from here
                      </h1>
                      <p className="text-xl text-gray-300 mb-8">The world's leading AI-powered developer platform.</p>
                      <div className="flex justify-center space-x-4">
                        <Button 
                          className="px-8 py-3 bg-green-600 hover:bg-green-700"
                          data-element-id="start-free-btn"
                          style={{
                            outline: highlightedElement === "start-free-btn" ? "2px solid #f44336" : "none",
                            outlineOffset: highlightedElement === "start-free-btn" ? "2px" : "0"
                          }}
                        >
                          Start for free
                        </Button>
                        <Button 
                          variant="outline" 
                          className="px-8 py-3 border-gray-400 text-white hover:bg-gray-800"
                          data-element-id="enterprise-btn"
                          style={{
                            outline: highlightedElement === "enterprise-btn" ? "2px solid #f44336" : "none",
                            outlineOffset: highlightedElement === "enterprise-btn" ? "2px" : "0"
                          }}
                        >
                          Start enterprise trial
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Load a website to see the preview</p>
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
                <Card 
                  key={element.id}
                  className="p-3 cursor-pointer hover:border-primary hover:bg-blue-50 transition-colors"
                  onMouseEnter={() => setHighlightedElement(element.id)}
                  onMouseLeave={() => setHighlightedElement(null)}
                >
                  <div className="flex items-start space-x-3">
                    {renderElementIcon(element.type)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm">
                        {element.text || `${element.type} element`}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{element.selector}</div>
                      <div className="text-xs text-blue-600 mt-1">#{element.id}</div>
                    </div>
                  </div>
                </Card>
              ))}
              {detectedElements.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No elements detected yet</p>
                  <p className="text-xs text-gray-400">Click "Detect Elements" to scan the loaded website</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Bottom Panel - Test Sequence Builder */}
      <div className="bg-white border-t border-gray-200 p-4" style={{ height: "250px" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Test Sequence</h3>
          <div className="flex items-center space-x-2">
            <Button variant="secondary" size="sm">
              <Play className="h-4 w-4 mr-2" />
              Execute Test
            </Button>
            <Button 
              onClick={handleSaveTest}
              disabled={saveTestMutation.isPending}
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveTestMutation.isPending ? "Saving..." : "Save Test"}
            </Button>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={handleClearSequence}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 p-4 h-48 overflow-x-auto">
          <div className="flex space-x-4 h-full">
            {testSequence.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <MousePointer className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <div className="text-sm">Drag actions and elements here to build your test</div>
                </div>
              </div>
            ) : (
              testSequence.map((step, index) => (
                <Card key={step.id} className="flex-shrink-0 w-64 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">Step {index + 1}</span>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-6 w-6 text-gray-400 hover:text-red-500"
                      onClick={() => {
                        setTestSequence(testSequence.filter(s => s.id !== step.id));
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded p-2 mb-2">
                    <div className="flex items-center space-x-2">
                      {renderActionIcon(step.action.icon)}
                      <span className="text-sm font-medium">{step.action.name}</span>
                    </div>
                  </div>
                  {step.element && (
                    <div className="bg-blue-50 border border-blue-200 rounded p-2">
                      <div className="flex items-center space-x-2">
                        {renderElementIcon(step.element.type)}
                        <span className="text-sm font-medium">{step.element.text || step.element.type}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">#{step.element.id}</div>
                    </div>
                  )}
                </Card>
              ))
            )}
            
            <div className="flex-shrink-0 w-64 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 p-4 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MousePointer className="h-6 w-6 mx-auto mb-2" />
                <div className="text-sm">Drop action here</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
