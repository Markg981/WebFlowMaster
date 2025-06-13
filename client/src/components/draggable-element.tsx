import { useDrag } from "react-dnd";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MousePointer } from "lucide-react";

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

interface DraggableElementProps {
  element: DetectedElement;
  onHover: (elementId: string | null) => void;
}

export function DraggableElement({ element, onHover }: DraggableElementProps) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "element",
    item: { id: element.id, type: "element", data: element },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }));

  const renderElementIcon = (type: string) => {
    const iconProps = { className: "h-4 w-4 text-gray-500" };
    switch (type) {
      case "input":
      case "text":
      case "password":
      case "email":
        return <Search {...iconProps} />;
      case "button":
      case "link":
        return <MousePointer {...iconProps} />;
      case "heading":
        return <span className="text-gray-500 font-bold text-sm">H</span>;
      default:
        return <MousePointer {...iconProps} />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "input":
      case "text":
      case "password":
      case "email":
      case "textarea":
        return "bg-blue-100 text-blue-800";
      case "button":
        return "bg-green-100 text-green-800";
      case "link":
        return "bg-purple-100 text-purple-800";
      case "heading":
        return "bg-gray-100 text-gray-800";
      case "select":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Card 
      ref={drag}
      className={`p-3 cursor-pointer hover:border-primary hover:bg-blue-50 transition-colors ${
        isDragging ? "opacity-50" : ""
      }`}
      onMouseEnter={() => onHover(element.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-start space-x-3">
        {renderElementIcon(element.type)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <Badge variant="secondary" className={`text-xs ${getTypeColor(element.type)}`}>
              {element.type}
            </Badge>
            <span className="text-xs text-gray-400">{element.tag}</span>
          </div>
          <div className="font-medium text-gray-900 text-sm truncate">
            {element.text || element.attributes.placeholder || element.attributes.alt || `${element.tag} element`}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {element.selector}
          </div>
        </div>
      </div>
    </Card>
  );
}