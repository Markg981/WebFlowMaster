import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { CheckCircle2, XCircle, Layers, Wand2, Bug } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useDrop } from 'react-dnd';
import { analyseFlow, flowDepths } from '@shared/flow';

const nodeTypes = {
  testNode: TestNode,
};

/** How far one level of if / loop moves a step to the right. */
const FLOW_INDENT_PX = 80;

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
  /** Runs the test so that it can stop at breakpoints and be corrected (shared/debug-session.ts). */
  onDebugTest?: () => void;
  breakpoints?: ReadonlySet<string>;
  onToggleBreakpoint?: (id: string) => void;
  /** The step a debug session is paused at, and whether it is paused on its failure. */
  debugPausedAt?: { stepId: string; failed: boolean } | null;
  /** How many dataset rows the test has: with more than one, Debug asks which. */
  debugRowCount?: number;
  debugRow?: number;
  onDebugRowChange?: (row: number) => void;
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
  onDebugTest,
  breakpoints,
  onToggleBreakpoint,
  debugPausedAt = null,
  debugRowCount = 0,
  debugRow = 0,
  onDebugRowChange,
}: VisualTestBuilderProps) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<Node<TestNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const flowAnalysis = useMemo(() => analyseFlow(testSequence), [testSequence]);
  const flowErrors = flowAnalysis.ok ? [] : flowAnalysis.errors;

  // Sincronizza TestSequence (JSON) con i Nodi di React Flow
  useEffect(() => {
    // Trasforma la sequenza lineare in nodi disposti verticalmente
    // Steps inside an if or a loop are shifted right, one step per level: in a flat column
    // nothing showed where a block started or ended.
    const depths = flowDepths(testSequence);
    const newNodes: Node<TestNodeData>[] = testSequence.map((step, index) => ({
      id: step.id,
      type: 'testNode',
      position: { x: 250 + depths[index] * FLOW_INDENT_PX, y: index * 200 + 50 }, // Posizionamento automatico a cascata
      data: {
        action: step.action,
        value: step.value,
        targetElement: step.targetElement,
        isRecordingActive,
        onUpdateValue: (id, val) => handleUpdateValue(id, val),
        onDeleteNode: (id) => handleDeleteNode(id),
        onSetTarget: (id, element) => handleSetTarget(id, element),
        breakpoint: breakpoints?.has(step.id) ?? false,
        onToggleBreakpoint,
        debugPaused: debugPausedAt?.stepId === step.id ? (debugPausedAt.failed ? 'failed' : 'before') : null,
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
  }, [testSequence, isExecuting, isRecordingActive, breakpoints, debugPausedAt, onToggleBreakpoint]);

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

      {/* The same check the runner makes before launching a browser, shown while the test is
          being written rather than after it has been run. */}
      {flowErrors.length > 0 && (
        <div role="alert" className="absolute bottom-4 left-4 z-10 max-w-md rounded-md border border-destructive/40 bg-card p-3 text-xs text-destructive shadow">
          <p className="font-semibold mb-1">{t('testSequenceBuilder.flowErrors', 'Blocks that do not close')}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {flowErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

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
        {onDebugTest && debugRowCount > 1 && onDebugRowChange && (
          <select
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={debugRow}
            onChange={(event) => onDebugRowChange(Number(event.target.value))}
            aria-label={t('debugger.row.label', 'Dataset row to debug with')}
            disabled={isExecuting}
          >
            {Array.from({ length: debugRowCount }, (_, row) => (
              <option key={row} value={row}>
                {t('debugger.row.option', 'Row {{n}}', { n: row + 1 })}
              </option>
            ))}
          </select>
        )}
        {onDebugTest && (
          <Button
            onClick={onDebugTest}
            disabled={isExecuting || testSequence.length === 0 || isRecordingActive}
            variant="outline"
            title={t('debugger.start.tooltip', 'Run step by step: stops at breakpoints and where a step fails')}
          >
            <Bug className="mr-2 h-4 w-4" />
            {t('debugger.start.button', 'Debug')}
          </Button>
        )}
        <Button onClick={onSaveTest} disabled={testSequence.length === 0 || isSaving} variant="secondary" className="flex-1">
          {isSaving ? t('apiTesterPage.loading.button') : t('apiTesterPage.saveTest.button')}
        </Button>
      </div>
    </div>
  );
}
