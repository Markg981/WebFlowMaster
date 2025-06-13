import { useDrop } from "react-dnd";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TestStep } from "@/components/drag-drop-provider";
import { Trash2, Settings, Plus } from "lucide-react";
import { 
  MousePointer, 
  Keyboard, 
  Clock, 
  Scroll, 
  CheckCircle, 
  Hand, 
  ChevronDown 
} from "lucide-react";

interface TestSequenceBuilderProps {
  testSequence: TestStep[];
  onUpdateSequence: (sequence: TestStep[]) => void;
  onExecuteTest: () => void;
  onSaveTest: () => void;
  onClearSequence: () => void;
  isExecuting?: boolean;
  isSaving?: boolean;
}

export function TestSequenceBuilder({
  testSequence,
  onUpdateSequence,
  onExecuteTest,
  onSaveTest,
  onClearSequence,
  isExecuting = false,
  isSaving = false
}: TestSequenceBuilderProps) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ["action", "element"],
    drop: (item: any) => {
      if (item.type === "action") {
        // Create new test step with action
        const newStep: TestStep = {
          id: `step-${Date.now()}`,
          action: item.data,
          element: undefined,
          value: ""
        };
        onUpdateSequence([...testSequence, newStep]);
      } else if (item.type === "element") {
        // Find the last step without an element and add this element to it
        const lastIncompleteStep = testSequence.findIndex(step => !step.element);
        if (lastIncompleteStep !== -1) {
          const updatedSequence = [...testSequence];
          updatedSequence[lastIncompleteStep] = {
            ...updatedSequence[lastIncompleteStep],
            element: item.data
          };
          onUpdateSequence(updatedSequence);
        }
      }
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  }));

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

  const updateStepValue = (stepId: string, value: string) => {
    const updatedSequence = testSequence.map(step =>
      step.id === stepId ? { ...step, value } : step
    );
    onUpdateSequence(updatedSequence);
  };

  const removeStep = (stepId: string) => {
    const updatedSequence = testSequence.filter(step => step.id !== stepId);
    onUpdateSequence(updatedSequence);
  };

  const needsValue = (actionType: string) => {
    return ["input", "wait", "assert"].includes(actionType);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Test Sequence</h3>
        <div className="flex items-center space-x-2">
          <Badge variant="secondary">{testSequence.length} steps</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearSequence}
            disabled={testSequence.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={drop}
        className={`flex-1 border-2 border-dashed rounded-lg p-4 transition-colors ${
          isOver 
            ? "border-primary bg-primary/5" 
            : "border-gray-300 bg-gray-50"
        }`}
      >
        {testSequence.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Plus className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Drop actions here to build your test</p>
              <p className="text-sm">Drag actions from the left sidebar, then add elements to complete each step</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {testSequence.map((step, index) => (
                <Card key={step.id} className="p-4 bg-white">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </div>
                    </div>
                    
                    <div className="flex-1 space-y-3">
                      {/* Action */}
                      <div className="flex items-center space-x-3">
                        {renderActionIcon(step.action.icon)}
                        <div>
                          <div className="font-medium text-gray-900">{step.action.name}</div>
                          <div className="text-sm text-gray-500">{step.action.description}</div>
                        </div>
                      </div>

                      {/* Element */}
                      {step.element ? (
                        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-blue-900 text-sm">
                                Target: {step.element.text || step.element.attributes.placeholder || `${step.element.tag} element`}
                              </div>
                              <div className="text-xs text-blue-700">
                                {step.element.selector}
                              </div>
                            </div>
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                              {step.element.type}
                            </Badge>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                          <div className="text-yellow-800 text-sm">
                            ⚠️ Drop an element here to complete this step
                          </div>
                        </div>
                      )}

                      {/* Value Input */}
                      {needsValue(step.action.type) && (
                        <div>
                          <Input
                            placeholder={
                              step.action.type === "input" ? "Enter text to type..." :
                              step.action.type === "wait" ? "Wait time in milliseconds..." :
                              step.action.type === "assert" ? "Expected text or value..." :
                              "Enter value..."
                            }
                            value={step.value || ""}
                            onChange={(e) => updateStepValue(step.id, e.target.value)}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(step.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Action Buttons */}
      <Separator className="my-4" />
      <div className="flex space-x-3">
        <Button
          onClick={onExecuteTest}
          disabled={testSequence.length === 0 || isExecuting}
          className="flex-1"
        >
          {isExecuting ? "Executing..." : "Execute Test"}
        </Button>
        <Button
          onClick={onSaveTest}
          disabled={testSequence.length === 0 || isSaving}
          variant="secondary"
          className="flex-1"
        >
          {isSaving ? "Saving..." : "Save Test"}
        </Button>
      </div>
    </div>
  );
}