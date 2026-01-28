import { useDrag, useDrop } from "react-dnd"; // Added useDrop
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import type { DetectedElement } from "./drag-drop-provider"; // Corrected path
import { 
  MousePointer, 
  Keyboard, 
  Clock, 
  Scroll, 
  CheckCircle, 
  Hand, 
  ChevronDown 
} from "lucide-react";

interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

interface DraggableActionProps {
  action: TestAction; // This is the definition of the action (e.g. 'click', 'type')
  stepId: string; // This is the unique ID of this action step in the sequence
  onDropElement: (stepId: string, element: DetectedElement) => void;
  targetElement?: DetectedElement; // Optional: To display info about the associated element
  isDropZoneActive?: boolean;
  isRecordingActive?: boolean;
}

export function DraggableAction({ 
  action, 
  stepId, 
  onDropElement, 
  targetElement,
  isDropZoneActive,
  isRecordingActive 
}: DraggableActionProps) {
  const { t } = useTranslation();
  const [{ isDragging: isActionDragging }, drag, dragPreview] = useDrag(() => ({
    type: "action",
    item: { id: action.id, type: "action", data: action },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(), // Standard isDragging for the action itself
    }),
  }));

  // Setup useDrop to accept "element" types
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: "element", // Accepts items of type "element"
    drop: (item: { id: string; type: string; data: DetectedElement }, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      // When an element is dropped on this action, call onDropElement with this action's stepId and the element data
      console.log('[DraggableAction drop] Dropped element:', item.data, 'on step:', stepId, 'action:', action.name);
      onDropElement(stepId, item.data);
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }), [action, stepId, onDropElement]); // Added stepId to dependencies

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

  return (
    <div ref={(node) => drag(drop(node))} className="mb-2"> {/* Attach both drag and drop refs */}
      <Card
        // The refs are now on the wrapper div, Card does not need them directly unless it forwards refs.
        // If Card is a simple div, we can apply refs directly to it. For now, wrapper is safer.
        className={`p-3 cursor-move hover:border-accent hover:bg-orange-50 transition-colors border-dashed ${
          isActionDragging ? "opacity-50" : "" // Use renamed isDragging state
        } ${isOver && canDrop ? "bg-green-100 border-green-500" : ""} ${ // Visual feedback for drop target
          !canDrop && isOver ? "bg-red-100 border-red-500" : "" // Visual feedback if cannot drop (e.g. wrong item type)
        }`}
      >
        <div className="flex items-center space-x-3">
          {renderActionIcon(action.icon)}
          <div>
            <div className="font-medium text-foreground text-sm">{action.name}</div>
            <div className="text-xs text-muted-foreground">{action.description}</div>
            {/* Display info about the target element if it exists */}
            {targetElement && (
              <div className="mt-1 pt-1 border-t border-gray-200">
                <p className="text-xs text-primary truncate" title={targetElement.selector}>
                  {t('draggableAction.target.label')} {targetElement.text || targetElement.selector}
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}