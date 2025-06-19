import { useState } from "react"; // Added useState
import { useDrop } from "react-dnd";
import { Card } from "@/components/ui/card"; // Keep for overall structure if needed, or remove if steps are Cards
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label"; // Added Label import
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"; // Added Select components
// Importing availableActions and TestAction from dashboard-page-new
import { availableActions, TestAction } from "@/pages/dashboard-page-new";
import { TestStep, DetectedElement } from "@/components/drag-drop-provider"; // TestAction removed from here
import { DraggableAction } from "./draggable-action"; // Import DraggableAction
import { Trash2, Settings, Plus, Link2, RefreshCw, CheckCircle2, XCircle } from "lucide-react"; // Added Link2 for element icon, RefreshCw as an option
// Icons for actions are now rendered by DraggableAction, so they might not be needed here directly
// unless used for other UI elements. Keeping them for now.
// Specific action icons (MousePointer, Keyboard, etc.) might not be needed if DraggableAction handles icon display
// based on action.icon string.
// import {
//   MousePointer,
//   Keyboard,
//   Clock,
//   Scroll,
//   CheckCircle,
//   Hand,
//   ChevronDown
// } from "lucide-react";


interface TestSequenceBuilderProps {
  testSequence: TestStep[]; // TestStep already includes optional targetElement
  onUpdateSequence: (sequence: TestStep[]) => void;
  onExecuteTest: () => void;
  onSaveTest: () => void;
  onClearSequence: () => void;
  isExecuting?: boolean;
  isSaving?: boolean;
  isRecordingActive?: boolean; // New prop
  lastTestOutcome?: boolean | null; // New prop for test outcome
}

export function TestSequenceBuilder({
  testSequence,
  onUpdateSequence,
  onExecuteTest,
  onSaveTest,
  onClearSequence,
  isExecuting = false,
  isSaving = false,
  isRecordingActive = false, // Default value for the new prop
  lastTestOutcome = null, // Default value for the new prop
}: TestSequenceBuilderProps) {
  const [isReassociatingElementForStepId, setReassociatingElementForStepId] = useState<string | null>(null);

  // Main drop target for adding NEW actions to the sequence
  const [{ isOver: isOverContainer, canDrop: canDropIntoContainer }, dropContainer] = useDrop(() => ({
    accept: "action", // Only accepts new actions now
    canDrop: () => !isRecordingActive, // Prevent drop if recording is active
    drop: (item: { id: string; type: string; data: TestAction }) => {
      if (isRecordingActive) return; // Double check, though canDrop should prevent this
      // Create new test step with action
      const newStep: TestStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, // More robust ID
        action: item.data, // Changed from item.action to item.data
        // targetElement will be added by dropping an element onto the DraggableAction for this step
        value: ""
      };
      onUpdateSequence([...testSequence, newStep]);
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }), [testSequence, onUpdateSequence, isRecordingActive]);

  const handleAssociateElementToAction = (stepId: string, droppedElement: DetectedElement) => {
    console.log('[TestSequenceBuilder] Associating element', droppedElement, 'to step:', stepId);
    const updatedSequence = testSequence.map(step => {
      if (step.id === stepId) {
        return { ...step, targetElement: droppedElement };
      }
      return step;
    });
    onUpdateSequence(updatedSequence);
    setReassociatingElementForStepId(null); // Clear re-association mode after drop
  };

  // This function might not be needed if DraggableAction renders its own icon
  // const renderActionIcon = (iconName: string) => { ... }

  const handleUpdateActionType = (stepId: string, newActionId: string) => {
    const newAction = availableActions.find(a => a.id === newActionId);
    if (!newAction) return;

    const updatedSequence = testSequence.map(step => {
      if (step.id === stepId) {
        // Use the helper functions `needsTargetElement` and `needsValue` directly
        return {
          ...step,
          action: newAction,
          value: needsValue(newAction.id) ? step.value : "", // Use newAction.id for checking
          targetElement: needsTargetElement(newAction.id) ? step.targetElement : undefined, // Use newAction.id
        };
      }
      return step;
    });
    onUpdateSequence(updatedSequence);
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

  const needsValue = (actionId: string) => { // Changed parameter to actionId for clarity
    return [
      "input",
      "wait",
      "assert", // General assert might still need a value
      "select",
      "assertTextContains",
      "assertElementCount"
    ].includes(actionId);
  };

  const needsTargetElement = (actionId: string) => { // Changed parameter to actionId
    return [
      "click",
      "input",
      "assert", // General assert
      "hover",
      "select",
      "assertTextContains",
      "assertElementCount"
    ].includes(actionId);
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
            disabled={testSequence.length === 0 || isRecordingActive}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={dropContainer}
        className={`flex-1 border-2 border-dashed rounded-lg p-4 transition-colors ${
          isOverContainer && canDropIntoContainer && !isRecordingActive
            ? "border-primary bg-primary/5"
            : isRecordingActive
            ? "border-border bg-muted/50 cursor-not-allowed" // Indicate recording active and no drop
            : "border-border bg-muted/20"
        }`}
      >
        {testSequence.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              {isRecordingActive ? (
                <>
                  <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-50 animate-spin" />
                  <p className="text-lg font-medium">Recording in progress...</p>
                  <p className="text-sm">Recorded actions will appear here.</p>
                </>
              ) : (
                <>
                  <Plus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">Drop actions here to build your test</p>
                  <p className="text-sm">Drag actions from the left sidebar, then add elements to complete each step</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {testSequence.map((step, index) => {
                const actionId = step.action?.id; // Use optional chaining

                return (
                  <div
                    key={step.id}
                    className={`flex items-start space-x-2 bg-card p-2 rounded-lg shadow transition-all ${
                      isReassociatingElementForStepId === step.id ? 'ring-2 ring-offset-2 ring-primary' : ''
                    }`}
                  >
                    {/* Step Number */}
                    <div className="flex-shrink-0 mt-3 ml-1">
                      <div className={`w-6 h-6 text-xs ${
                          actionId && needsTargetElement(actionId) && !step.targetElement ? "bg-destructive" :
                          step.targetElement ? "bg-green-600" : "bg-primary"
                        } text-primary-foreground rounded-full flex items-center justify-center font-medium`}>
                        {index + 1}
                      </div>
                    </div>

                    {/* Action Type Dropdown and Re-associate Button */}
                    <div className="flex flex-col space-y-1 items-start" style={{width: "180px"}}>
                      <Select
                        value={actionId || ''}
                        onValueChange={(newActionId) => handleUpdateActionType(step.id, newActionId)}
                        disabled={isRecordingActive} // Disable during recording
                      >
                        <SelectTrigger className="w-full h-9 text-xs">
                          <SelectValue placeholder="Change action" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableActions.map(action => (
                            <SelectItem key={action.id} value={action.id} className="text-xs">
                              {action.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {actionId && needsTargetElement(actionId) && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => !isRecordingActive && setReassociatingElementForStepId(step.id)} // Prevent click if recording
                          className="text-xs h-7"
                          disabled={isRecordingActive} // Disable during recording
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          {step.targetElement ? 'Change Element' : 'Set Element'}
                        </Button>
                      )}
                    </div>

                    {/* DraggableAction as the representation of the action part of the step (or target drop zone) */}
                    <div className="flex-1">
                      <DraggableAction
                        action={step.action}
                        stepId={step.id}
                        onDropElement={handleAssociateElementToAction} // Drop logic for elements is still handled by DraggableAction
                        targetElement={step.targetElement}
                        isDropZoneActive={isReassociatingElementForStepId === step.id && !isRecordingActive} // Only active if not recording
                        isRecordingActive={isRecordingActive} // Pass down for internal control if needed
                      />
                    </div>

                    {/* Value Input */}
                    {actionId && needsValue(actionId) && (
                      <div className="flex-1 min-w-0 ml-2 mt-0.5"> {/* Adjusted margin */}
                         <Label htmlFor={`step-value-${step.id}`} className="text-xs text-muted-foreground">
                          {actionId === "input" ? "Text to input" :
                           actionId === "select" ? "Option value" :
                           actionId === "wait" ? "Time (ms)" :
                           actionId === "assertTextContains" ? "Expected text" :
                           actionId === "assertElementCount" ? "Count (e.g. ==1)" :
                           actionId === "assert" ? "Expected value" : "Value"}
                        </Label>
                        <Input
                          id={`step-value-${step.id}`}
                          placeholder={
                            actionId === "input" ? "Enter text..." :
                            actionId === "select" ? "Enter option value..." :
                            actionId === "wait" ? "e.g., 1000" :
                            actionId === "assertTextContains" ? "Text the element should contain..." :
                            actionId === "assertElementCount" ? "e.g., '==1', '>=5', '<3'" :
                            actionId === "assert" ? "Expected text or attribute value..." :
                            "Value..."
                          }
                          value={step.value || ""}
                          onChange={(e) => updateStepValue(step.id, e.target.value)}
                          className="text-sm h-9"
                          readOnly={isRecordingActive} // Make read-only during recording
                        />
                      </div>
                    )}

                  {/* Remove Step Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => !isRecordingActive && removeStep(step.id)} // Prevent click if recording
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 mt-2"
                    aria-label="Remove step"
                    disabled={isRecordingActive} // Disable during recording
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                ); // Closes the return statement of the map callback
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Action Buttons */}
      <Separator className="my-4" /> {/* Separator component from ui/ is theme-aware */}
      <div className="flex items-center space-x-3"> {/* Added items-center for vertical alignment */}
        {lastTestOutcome === true && (
          <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
        )}
        {lastTestOutcome === false && (
          <XCircle className="mr-2 h-5 w-5 text-red-500" />
        )}
        <Button
          onClick={onExecuteTest}
          disabled={isExecuting}
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