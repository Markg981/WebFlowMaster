import { useDrag } from "react-dnd";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MousePointer, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  /** Offered when the page can keep this element in a project's repository. */
  onKeep?: (element: DetectedElement) => void;
}

export function DraggableElement({ element, onHover, onKeep }: DraggableElementProps) {
  const { t } = useTranslation();
  // `element` MUST be in the deps array: detected-element ids are positional
  // (regenerated from 0 on every detect), so React reuses the same DraggableElement
  // instance for a different element after a re-detect. Without deps, useDrag keeps the
  // stale item from first render and the wrong element gets bound to the step.
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "element",
    item: { id: element.id, type: "element", data: element },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [element]);

  const renderElementIcon = (type: string) => {
    const iconProps = { className: "h-4 w-4 text-muted-foreground" };
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
        return <span className="text-muted-foreground font-bold text-sm">H</span>;
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
        return "bg-primary text-primary-foreground";
      case "button":
        return "bg-success text-primary-foreground";
      case "link":
        return "bg-accent text-accent-foreground";
      case "heading":
        return "bg-secondary text-secondary-foreground";
      case "select":
        return "bg-secondary text-secondary-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
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
            <span className="text-xs text-muted-foreground">{element.tag}</span>
          </div>
          <div className="font-medium text-foreground text-sm truncate">
            {element.text || element.attributes.placeholder || element.attributes.alt || `${element.tag} ${t('draggableElement.element.text')}`}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {element.selector}
          </div>
        </div>
        {/* Keeping an element means the project owns it: every test that names it reads one
            selector, and a repair reaches all of them at once instead of one failure at a
            time. Without this the only way in was the API. */}
        {onKeep && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t('draggableElement.keep.tooltip', 'Keep this element in the project repository')}
            aria-label={t('draggableElement.keep.tooltip', 'Keep this element in the project repository')}
            onClick={(event) => {
              event.stopPropagation();
              onKeep(element);
            }}
          >
            <Bookmark className="h-3 w-3" />
          </Button>
        )}
      </div>
    </Card>
  );
}