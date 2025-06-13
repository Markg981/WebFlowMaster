import { createContext, ReactNode, useContext } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

export interface DragItem {
  id: string;
  type: 'action' | 'element';
  data: any;
}

export interface TestStep {
  id: string;
  action: {
    id: string;
    type: string;
    name: string;
    icon: string;
    description: string;
  };
  element?: {
    id: string;
    type: string;
    selector: string;
    text: string;
    tag: string;
    attributes: Record<string, string>;
  };
  value?: string;
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
