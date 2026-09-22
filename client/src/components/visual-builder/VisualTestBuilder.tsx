import React, { useCallback, useEffect, useState } from 'react';
import { 
  ReactFlow,
  Background,
  Node,
  Edge,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  ConnectionMode,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { TestStep, DetectedElement } from '@/components/drag-drop-provider';
import { TestNode, TestNodeData } from './TestNode';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Layers, Wand2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useDrop } from 'react-dnd';

const nodeTypes = {
  testNode: TestNode,
};

interface VisualTestBuilderProps {
  testSequence: TestStep[];
  onUpdateSequence: (sequence: TestStep[]) => void;
  onExecuteTest: () => void;
  onSaveTest: () => void;
  onClearSequence: () => void;
  isExecuting?: boolean;
  isSaving?: boolean;
  isRecordingActive?: boolean;
  lastTestOutcome?: boolean | null;
  /** Turns what is on the canvas into a named group that other tests can call. */
  onSaveAsGroup?: () => void;
  /** Starts from the description of the test instead of from an empty canvas. */
  onDescribeTest?: () => void;
}

export function VisualTestBuilder({
  testSequence,
  onUpdateSequence,
  onExecuteTest,
  onSaveTest,
  onClearSequence,
  isExecuting = false,
  isSaving = false,
  isRecordingActive = false,
  lastTestOutcome = null,
  onSaveAsGroup,
  onDescribeTest,
}: VisualTestBuilderProps) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<Node<TestNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Sincronizza TestSequence (JSON) con i Nodi di React Flow
  useEffect(() => {
    // Trasforma la sequenza lineare in nodi disposti verticalmente
    const newNodes: Node<TestNodeData>[] = testSequence.map((step, index) => ({
      id: step.id,
      type: 'testNode',
      position: { x: 250, y: index * 200 + 50 }, // Posizionamento automatico a cascata
      data: {
        action: step.action,
        value: step.value,
        targetElement: step.targetElement,
        isRecordingActive,
        onUpdateValue: (id, val) => handleUpdateValue(id, val),
        onDeleteNode: (id) => handleDeleteNode(id),
        onSetTarget: (id, element) => handleSetTarget(id, element)
      }
    }));

    // Crea automaticamente i collegamenti (Edges)
    const newEdges: Edge[] = [];
    for (let i = 0; i < testSequence.length - 1; i++) {
      newEdges.push({
        id: `e-${testSequence[i].id}-${testSequence[i+1].id}`,
        source: testSequence[i].id,
        target: testSequence[i+1].id,
        animated: isExecuting,
        style: { stroke: isExecuting ? '#3b82f6' : '#9ca3af', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isExecuting ? '#3b82f6' : '#9ca3af' },
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
    // handleUpdateValue/handleDeleteNode close over testSequence (already a dep) and the
    // stable onUpdateSequence prop; the effect re-syncs whenever testSequence changes, so
    // listing the (non-memoized) handlers would only cause redundant re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testSequence, isExecuting, isRecordingActive]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds) as Node<TestNodeData>[]),
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ 
      ...params, 
      animated: false,
      style: { stroke: '#9ca3af', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' }
    }, eds)),
    []
  );

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: "action",
    drop: (item: any) => {
      if (isRecordingActive) return;
      const newStep: TestStep = {
        id: `step-${Date.now()}`,
        action: item.data,
        // A step group is dragged like any action, and the group it names travels in `value` —
        // which is where the runner looks when it expands the call.
        value: item.data?.groupId ?? ""
      };
      onUpdateSequence([...testSequence, newStep]);
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  }), [testSequence, onUpdateSequence, isRecordingActive]);

  // Callback passate al custom node
  const handleUpdateValue = (id: string, value: string) => {
    const updated = testSequence.map(s => s.id === id ? { ...s, value } : s);
    onUpdateSequence(updated);
  };

  const handleDeleteNode = (id: string) => {
    const updated = testSequence.filter(s => s.id !== id);
    onUpdateSequence(updated);
  };

  const handleSetTarget = (id: string, element: DetectedElement) => {
    const updated = testSequence.map(s => s.id === id ? { ...s, targetElement: element } : s);
    onUpdateSequence(updated);
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="absolute top-4 right-4 z-10 space-x-2">
        {onDescribeTest && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDescribeTest}
            disabled={isRecordingActive}
            title={t('testSequenceBuilder.describe.tooltip', 'Write what the test does and turn it into steps')}
          >
            <Wand2 className="h-4 w-4 mr-1" />
            {t('testSequenceBuilder.describe.button', 'Describe')}
          </Button>
        )}
        {onSaveAsGroup && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveAsGroup}
            disabled={testSequence.length === 0 || isRecordingActive}
            title={t('testSequenceBuilder.saveAsGroup.tooltip', 'Save these steps as a group other tests can call')}
          >
            <Layers className="h-4 w-4 mr-1" />
            {t('testSequenceBuilder.saveAsGroup.button', 'Save as group')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onClearSequence} disabled={testSequence.length === 0 || isRecordingActive}>
          {t('testSequenceBuilder.clear.button')}
        </Button>
      </div>

      <div 
        ref={dropRef} 
        className={`flex-1 border rounded-lg overflow-hidden transition-colors ${isOver ? 'border-primary bg-primary/5' : 'bg-muted/20'}`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Strict}
          fitView
          className="bg-dot-pattern"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="hsl(var(--border))" gap={16} />
        </ReactFlow>
      </div>

      <Separator className="my-4" />
      <div className="flex items-center space-x-3">
        {lastTestOutcome === true && <CheckCircle2 className="mr-2 h-5 w-5 text-success" />}
        {lastTestOutcome === false && <XCircle className="mr-2 h-5 w-5 text-destructive" />}
        <Button onClick={onExecuteTest} disabled={isExecuting} className="flex-1">
          {isExecuting ? t('apiTesterPage.loading.button') : t('testSequenceBuilder.executeTest.button')}
        </Button>
        <Button onClick={onSaveTest} disabled={testSequence.length === 0 || isSaving} variant="secondary" className="flex-1">
          {isSaving ? t('apiTesterPage.loading.button') : t('apiTesterPage.saveTest.button')}
        </Button>
      </div>
    </div>
  );
}
