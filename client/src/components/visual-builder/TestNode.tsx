import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useDrop } from 'react-dnd';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TestAction } from '@/pages/dashboard-page-new';
import { DetectedElement } from '@/components/drag-drop-provider';
import { useTranslation } from 'react-i18next';
import { Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type TestNodeData = {
  action: TestAction;
  value?: string;
  targetElement?: DetectedElement;
  isRecordingActive?: boolean;
  onUpdateValue: (id: string, value: string) => void;
  onDeleteNode: (id: string) => void;
  onSetTarget?: (id: string, element: DetectedElement) => void;
  [key: string]: unknown; // Satisfy Record<string, unknown> constraint
};

export function TestNode({ id, data }: NodeProps<Node<TestNodeData>>) {
  const { t } = useTranslation();

  // "assert" is the visibility check: it needs a target but no value. "navigate" is the
  // opposite — a URL, no element.
  const needsValue = ["input", "wait", "select", "navigate", "assertTextContains", "assertElementCount"].includes(data.action.id);
  const needsTarget = ["click", "input", "assert", "hover", "select", "assertTextContains", "assertElementCount"].includes(data.action.id);

  // Accept a detected element dropped from the "Detected Elements" panel and bind it as
  // this step's target. Without this drop target the dragged element had nowhere to land
  // and react-dnd snapped it back (it appeared to "vanish").
  const [{ isOver, canDrop }, dropRef] = useDrop(() => ({
    accept: "element",
    canDrop: () => !data.isRecordingActive,
    drop: (item: { data: DetectedElement }) => {
      if (data.isRecordingActive) return;
      data.onSetTarget?.(id, item.data);
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }), [id, data.isRecordingActive, data.onSetTarget]);

  return (
    <Card className={`min-w-[250px] p-4 shadow-lg border-2 ${data.targetElement ? 'border-primary' : (needsTarget ? 'border-destructive/50' : 'border-border')} bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75 transition-all`}>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-primary" />
      
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            {/* Si potrebbe usare l'icona dell'azione qui, per ora usiamo un pallino */}
            <div className="w-4 h-4 rounded-full bg-primary" />
          </div>
          <span className="font-semibold text-sm">{t(data.action.name)}</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => data.onDeleteNode(id)}
          disabled={data.isRecordingActive}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-3 mt-4">
        {needsTarget && (
          <div
            ref={dropRef as any}
            className={`nodrag flex items-center space-x-2 p-2 rounded-md border transition-colors ${
              isOver && canDrop
                ? 'bg-primary/10 border-primary border-dashed'
                : data.targetElement
                  ? 'bg-muted/50 border-primary/40'
                  : 'bg-muted/50 border-destructive/40 border-dashed'
            }`}
          >
            <Link2 className={`h-4 w-4 shrink-0 ${data.targetElement ? 'text-green-500' : 'text-muted-foreground'}`} />
            <span className="text-xs truncate max-w-[180px]">
              {data.targetElement ? data.targetElement.text : t('dashboardPage.dropActionsPrompt')}
            </span>
          </div>
        )}

        {needsValue && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('testSequenceBuilder.value.label')}
            </Label>
            <Input 
              className="h-7 text-xs nodrag" 
              value={data.value || ""}
              onChange={(e) => data.onUpdateValue(id, e.target.value)}
              disabled={data.isRecordingActive}
              placeholder={t('testSequenceBuilder.value.placeholder')}
            />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-primary" />
    </Card>
  );
}
