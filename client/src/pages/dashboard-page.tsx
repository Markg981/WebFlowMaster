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
import { DraggableAction } from "@/components/draggable-action";
import { DraggableElement } from "@/components/draggable-element";
import { TestSequenceBuilder } from "@/components/test-sequence-builder";
import { TestStep as DragDropTestStep } from "@/components/drag-drop-provider";
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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(); // Initialize useTranslation
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
          title: t('dashboardPage.toast.websiteLoadedTitle'),
          description: t('dashboardPage.toast.websiteLoadedDesc'),
        });
      } else {
        throw new Error(data.error || "Failed to load website");
      }
    },
    onError: (error: Error) => {
      setWebsiteLoaded(false);
      setWebsiteScreenshot(null);
      toast({
        title: t('dashboardPage.toast.websiteLoadErrorTitle'),
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
        title: t('dashboardPage.toast.elementsDetectedTitle'),
        description: t('dashboardPage.toast.elementsDetectedDesc', { count: data.elements.length }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('dashboardPage.toast.elementsDetectErrorTitle'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveTestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tests", {
        name: t('dashboardPage.toast.defaultTestName', {url: currentUrl}), // Example for test name
        url: currentUrl,
        sequence: testSequence,
        // elements: detectedElements, // This might be large, consider if it needs to be saved this way
        status: "saved"
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('dashboardPage.toast.testSavedTitle'),
        description: t('dashboardPage.toast.testSavedDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('dashboardPage.toast.testSaveErrorTitle'),
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
              <h1 className="text-xl font-bold text-gray-900">{t('dashboardPage.headerTitle')}</h1>
            </div>
            
            <nav className="hidden md:flex space-x-6">
              <span className="text-primary font-medium border-b-2 border-primary pb-2">{t('dashboardPage.navCreateTest')}</span>
              <span className="text-gray-600 hover:text-gray-900 pb-2 cursor-pointer">{t('dashboardPage.navMyTests')}</span>
              <span className="text-gray-600 hover:text-gray-900 pb-2 cursor-pointer">{t('dashboardPage.navReports')}</span>
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
              {t('dashboardPage.signOutButton')}
            </Button>
          </div>
        </div>
      </header>

      {/* URL Input Section */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <Label className="block text-sm font-medium text-gray-700 mb-2">{t('dashboardPage.urlInputLabel')}</Label>
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
                {loadWebsiteMutation.isPending ? t('dashboardPage.loadingWebsiteButton') : t('dashboardPage.loadWebsiteButton')}
              </Button>
              <Button 
                onClick={handleDetectElements}
                disabled={detectElementsMutation.isPending || !websiteLoaded}
                variant="secondary"
              >
                <Search className="h-4 w-4 mr-2" />
                {detectElementsMutation.isPending ? t('dashboardPage.detectingElementsButton') : t('dashboardPage.detectElementsButton')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex h-[calc(100vh-200px)]">
        {/* Left Sidebar - Actions */}
        <div className="w-80 bg-white border-r border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboardPage.availableActionsTitle')}</h3>
          
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {availableActions.map((action) => (
                <DraggableAction key={action.id} action={action} />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Center - Website Preview */}
        <div className="flex-1 bg-white border-r border-gray-200 p-4">
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{t('dashboardPage.websitePreviewTitle')}</h3>
              <div className="flex items-center space-x-2">
                {websiteLoaded && (
                  <Badge variant="secondary" className="bg-success text-white">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t('dashboardPage.previewLoadedBadge')}
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
                  {/* Element highlighting overlay */}
                  {highlightedElement && (
                    <div 
                      className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20 pointer-events-none"
                      style={{
                        // This would be positioned based on element.boundingBox if available
                        top: '50px',
                        left: '50px',
                        width: '200px',
                        height: '40px'
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('dashboardPage.previewLoadPrompt')}</p>
                    <p className="text-sm mt-2">{t('dashboardPage.previewScreenshotHint')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Detected Elements */}
        <div className="w-80 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('dashboardPage.detectedElementsTitle')}</h3>
            <Badge variant="secondary">{t('dashboardPage.elementsFoundBadge', { count: detectedElements.length })}</Badge>
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
              {detectedElements.length === 0 && !detectElementsMutation.isPending && websiteLoaded && (
                <div className="text-center text-gray-500 py-8">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('dashboardPage.noElementsDetected')}</p>
                  <p className="text-xs text-gray-400">{t('dashboardPage.detectElementsPrompt')}</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Bottom Panel - Test Sequence Builder */}
      {/* The TestSequenceBuilder component itself would need to be refactored to use useTranslation if its internal text needs translation */}
      {/* For this PoC, we are focusing on DashboardPage.tsx text. */}
      {/* The props passed to TestSequenceBuilder might contain translatable text in the future. */}
      <div className="bg-white border-t border-gray-200 p-4" style={{ height: "auto" }}> {/* Adjusted height */}
         <TestSequenceBuilder
            testSequence={testSequence}
            onUpdateSequence={setTestSequence}
            onExecuteTest={() => console.log("Execute test from dashboard")}
            onSaveTest={handleSaveTest}
            onClearSequence={handleClearSequence}
            isExecuting={false} // Placeholder
            isSaving={saveTestMutation.isPending}
            // Pass translated strings for TestSequenceBuilder if it supports them
            // For example:
            // executeButtonText={t('dashboardPage.executeTestButton')}
            // savingButtonText={t('dashboardPage.savingTestButton')}
            // saveButtonText={t('dashboardPage.saveTestButton')}
            // clearButtonText={t('dashboardPage.clearSequenceButton')}
            // dropActionsPromptText={t('dashboardPage.dropActionsPrompt')}
            // dropActionsHintText={t('dashboardPage.dropActionsHint')}
            // titleText={t('dashboardPage.testSequenceTitle')}
         />
      </div>
    </div>
  );
}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
