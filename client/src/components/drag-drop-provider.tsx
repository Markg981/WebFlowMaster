import { createContext, ReactNode, useContext } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

export interface DragItem {
  id: string;
  type: 'action' | 'element';
  data: any; // This would ideally be more specific, e.g., TestAction or DetectedElement
}

// Define DetectedElement here (or import from a shared types file if available)
// This definition should match the one in dashboard-page-new.tsx
export interface DetectedElement {
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

export interface TestStep {
  id: string; // Unique ID for the step in the sequence
  action: { // Original action data (what to do)
    id: string; // e.g., 'click', 'input'
    type: string; // e.g., 'click', 'input'
    name: string; // e.g., 'Click Element', 'Input Text'
    icon: string;
    description: string;
  };
  targetElement?: DetectedElement; // The detected element this action targets
  value?: string; // For input actions, the text to type, etc.
}

type DragDropContextType = {
  // Context methods can be added here if needed
};

const DragDropContext = createContext<DragDropContextType | null>(null);

export function DragDropProvider({ children }: { children: ReactNode }) {
  return (
    <DndProvider backend={HTML5Backend}>
      <DragDropContext.Provider value={{}}>
        {children}
      </DragDropContext.Provider>
    </DndProvider>
  );
}

export function useDragDrop() {
  const context = useContext(DragDropContext);
  if (!context) {
    throw new Error("useDragDrop must be used within a DragDropProvider");
  }
  return context;
}
