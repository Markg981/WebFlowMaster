import { useDrag, useDrop } from "react-dnd"; // Added useDrop
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import type { DetectedElement } from "./drag-drop-provider"; // Corrected path
import { ActionIcon } from "@/lib/action-icons";

interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

interface DraggableActionProps {
  action: TestAction; // This is the definition of the action (e.g. 'click', 'type')
  stepId?: string; // Optional for palette usage
  onDropElement?: (stepId: string, element: DetectedElement) => void;
  targetElement?: DetectedElement; // Optional: To display info about the associated element
  isDropZoneActive?: boolean;
  isRecordingActive?: boolean;
}

export function DraggableAction({ 
  action, 
  stepId, 
  onDropElement,
  targetElement,
}: DraggableActionProps) {
  const { t } = useTranslation();
  const [{ isDragging: isActionDragging }, drag] = useDrag(() => ({
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
      if (monitor.didDrop() || !onDropElement || !stepId) {
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

  // In the palette there is no step to drop an element onto, so nothing accepts a drop here
  // and the dashed border would be promising something that cannot happen.
  const isDropTarget = Boolean(stepId && onDropElement);

  return (
    <div ref={(node) => drag(drop(node))} className="mb-2"> {/* Attach both drag and drop refs */}
      <Card
        // The refs are now on the wrapper div, Card does not need them directly unless it forwards refs.
        // If Card is a simple div, we can apply refs directly to it. For now, wrapper is safer.
        className={`p-3 cursor-grab active:cursor-grabbing transition-colors hover:border-primary/40 hover:bg-accent ${
          isDropTarget ? "border-dashed" : ""
        } ${
          isActionDragging ? "opacity-50" : "" // Use renamed isDragging state
        } ${isOver && canDrop ? "bg-success-weak border-success" : ""} ${ // Visual feedback for drop target
          !canDrop && isOver ? "bg-destructive-weak border-destructive" : "" // Visual feedback if cannot drop (e.g. wrong item type)
        }`}
      >
        <div className="flex items-center space-x-3">
          <ActionIcon action={action.id} className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="font-medium text-foreground text-sm">{t(action.name)}</div>
            <div className="text-xs text-muted-foreground">{t(action.description)}</div>
            {/* Display info about the target element if it exists */}
            {targetElement && (
              <div className="mt-1 pt-1 border-t border-border">
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