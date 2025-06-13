import { useDrag } from "react-dnd";
import { Card } from "@/components/ui/card";
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
  action: TestAction;
}

export function DraggableAction({ action }: DraggableActionProps) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "action",
    item: { id: action.id, type: "action", data: action },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
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

  return (
    <Card 
      ref={drag}
      className={`p-3 cursor-move hover:border-accent hover:bg-orange-50 transition-colors border-dashed ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center space-x-3">
        {renderActionIcon(action.icon)}
        <div>
          <div className="font-medium text-gray-900 text-sm">{action.name}</div>
          <div className="text-xs text-gray-500">{action.description}</div>
        </div>
      </div>
    </Card>
  );
}