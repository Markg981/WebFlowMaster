import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DraggableAction } from '../draggable-action';
import { VisualTestBuilder, buildStepFromAction } from './VisualTestBuilder';

/**
 * C-18: the only way to put a step in the sequence was to drag it with a mouse. The palette
 * now has an "Add" button on every action and the steps have move up / move down, so the
 * builder works from the keyboard and by touch.
 */

vi.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, () => {}],
  useDrop: () => [{ isOver: false, canDrop: false }, () => {}],
}));

// A flat list of the node components instead of the canvas, which needs layout the test
// environment does not have.
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Background: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  ConnectionMode: { Loose: 'loose' },
  addEdge: (e: unknown, es: unknown[]) => [...es, e],
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e,
  ReactFlow: ({ nodes, nodeTypes }: any) => {
    const Node = nodeTypes.testNode;
    return (
      <ol>
        {nodes.map((n: any) => (
          <li key={n.id} data-testid={n.id}>
            <Node id={n.id} data={n.data} />
          </li>
        ))}
      </ol>
    );
  },
}));

const action = (id: string) => ({
  id,
  type: id,
  name: id,
  icon: 'x',
  description: `${id} description`,
});

describe('palette: add without dragging', () => {
  it('offers a focusable, named Add button that hands the action over', () => {
    const onAdd = vi.fn();
    render(<DraggableAction action={action('click')} onAdd={onAdd} />);

    // A native button: Tab reaches it and Enter / Space fire its click, no key handler needed.
    const add = screen.getByRole('button', { name: /click/ });
    expect(add.tagName).toBe('BUTTON');
    expect(add).not.toHaveAttribute('tabindex', '-1');
    add.focus();
    expect(add).toHaveFocus();
    fireEvent.click(add);

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'click' }));
  });

  it('builds the same step the drop builds, group id included', () => {
    const step = buildStepFromAction({ ...action('stepGroup'), groupId: 'g1' });
    expect(step.value).toBe('g1');
    expect(step.action.id).toBe('stepGroup');
  });
});

describe('steps: move up / down', () => {
  const sequence = ['a', 'b', 'c'].map((id) => ({ id, action: action(id) as any, value: '' }));

  const renderBuilder = () => {
    const onUpdateSequence = vi.fn();
    render(
      <VisualTestBuilder
        testSequence={sequence}
        onUpdateSequence={onUpdateSequence}
        onExecuteTest={vi.fn()}
        onSaveTest={vi.fn()}
        onClearSequence={vi.fn()}
      />,
    );
    return onUpdateSequence;
  };

  const inStep = (id: string, label: string) =>
    within(screen.getByTestId(id)).getByRole('button', { name: new RegExp(label) });

  it('moves a step down and up by one place', () => {
    const onUpdateSequence = renderBuilder();

    fireEvent.click(inStep('a', 'Move step down|Sposta lo step giù'));
    expect(onUpdateSequence).toHaveBeenLastCalledWith([sequence[1], sequence[0], sequence[2]]);

    fireEvent.click(inStep('c', 'Move step up|Sposta lo step su'));
    expect(onUpdateSequence).toHaveBeenLastCalledWith([sequence[0], sequence[2], sequence[1]]);
  });

  it('disables up on the first step and down on the last', () => {
    renderBuilder();
    expect(inStep('a', 'Move step up|Sposta lo step su')).toBeDisabled();
    expect(inStep('c', 'Move step down|Sposta lo step giù')).toBeDisabled();
  });
});
