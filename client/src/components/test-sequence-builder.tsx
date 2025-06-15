import { useDrop } from "react-dnd";
import { Card } from "@/components/ui/card"; // Keep for overall structure if needed, or remove if steps are Cards
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TestStep, DetectedElement } from "@/components/drag-drop-provider"; // Import DetectedElement
import { DraggableAction } from "./draggable-action"; // Import DraggableAction
import { Trash2, Settings, Plus, Link2 } from "lucide-react"; // Added Link2 for element icon
// Icons for actions are now rendered by DraggableAction, so they might not be needed here directly
// unless used for other UI elements. Keeping them for now.
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
  testSequence: TestStep[]; // TestStep already includes optional targetElement
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

  // Main drop target for adding NEW actions to the sequence
  const [{ isOver: isOverContainer }, dropContainer] = useDrop(() => ({
    accept: "action", // Only accepts new actions now
    drop: (item: { id: string; type: string; data: any /* TestAction type from DraggableAction's item */ }) => {
      // Create new test step with action
      const newStep: TestStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, // More robust ID
        action: item.data, // item.data is the TestAction object
        // targetElement will be added by dropping an element onto the DraggableAction for this step
        value: ""
      };
      onUpdateSequence([...testSequence, newStep]);
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  }), [testSequence, onUpdateSequence]);

  const handleAssociateElementToAction = (stepId: string, droppedElement: DetectedElement) => {
    console.log('[TestSequenceBuilder] Associating element', droppedElement, 'to step:', stepId);
    const updatedSequence = testSequence.map(step => {
      if (step.id === stepId) {
        return { ...step, targetElement: droppedElement };
      }
      return step;
    });
    onUpdateSequence(updatedSequence);
  };

  // This function might not be needed if DraggableAction renders its own icon
  // const renderActionIcon = (iconName: string) => { ... }

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
        ref={dropContainer} {/* Corrected ref variable */}
        className={`flex-1 border-2 border-dashed rounded-lg p-4 transition-colors ${
          isOverContainer /* Corrected state variable for hover */
            ? "border-primary bg-primary/5" 
            : "border-border bg-muted/20" /* Use theme-aware colors */
        }`}
      >
        {testSequence.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground"> {/* Use theme-aware color */}
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
                <div key={step.id} className="flex items-start space-x-2 bg-card p-1 rounded-lg shadow">
                  {/* Step Number */}
                  <div className="flex-shrink-0 mt-3 ml-1">
                    <div className={`w-6 h-6 text-xs ${step.targetElement ? "bg-green-600" : "bg-primary"} text-primary-foreground rounded-full flex items-center justify-center font-medium`}>
                      {index + 1}
                    </div>
                  </div>

                  {/* DraggableAction as the representation of the action part of the step */}
                  <div className="flex-1">
                    <DraggableAction
                      action={step.action}
                      stepId={step.id} // Pass step.id for association
                      onDropElement={handleAssociateElementToAction}
                      targetElement={step.targetElement} // Pass for display within DraggableAction
                    />
                  </div>

                  {/* Value Input - Placed outside DraggableAction, but related to the step */}
                  {needsValue(step.action.type) && (
                    <div className="flex-1 min-w-0 ml-2 mt-2"> {/* Ensure it has space */}
                       <Label htmlFor={`step-value-${step.id}`} className="text-xs text-muted-foreground">
                        {step.action.type === "input" ? "Text to input" :
                         step.action.type === "wait" ? "Time (ms)" :
                         step.action.type === "assert" ? "Expected value" : "Value"}
                      </Label>
                      <Input
                        id={`step-value-${step.id}`}
                        placeholder={
                          step.action.type === "input" ? "Enter text..." :
                          step.action.type === "wait" ? "e.g., 1000" :
                          step.action.type === "assert" ? "Expected text..." :
                          "Value..."
                        }
                        value={step.value || ""}
                        onChange={(e) => updateStepValue(step.id, e.target.value)}
                        className="text-sm h-9" // Adjusted height
                      />
                    </div>
                  )}

                  {/* Remove Step Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeStep(step.id)}
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 mt-2"
                    aria-label="Remove step"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Action Buttons */}
      <Separator className="my-4" /> {/* Separator component from ui/ is theme-aware */}
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