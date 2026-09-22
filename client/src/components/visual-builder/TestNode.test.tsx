import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ACTION_VALUE_OPTIONS, SETTABLE_STATES } from '@shared/recording';

import { TestNode, type TestNodeData } from './TestNode';

/**
 * The step card in the visual builder.
 *
 * `assertState` and `ensureState` take one of a closed list of states, and the runner
 * refuses anything else by name. The field here was free text, so the list existed only in
 * the runner and in a comment: a step written as "Checked" or with a trailing space was
 * accepted by the builder, saved, scheduled, and failed at run time on a machine nobody was
 * watching. Offering the list is what makes the two halves agree.
 */

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

vi.mock('react-dnd', () => ({
  useDrop: () => [{ isOver: false, canDrop: false }, () => {}],
}));

const nodeData = (actionId: string, value?: string): TestNodeData => ({
  action: { id: actionId, type: actionId, name: actionId, icon: 'x', description: actionId },
  value,
  onUpdateValue: vi.fn(),
  onDeleteNode: vi.fn(),
});

const renderNode = (actionId: string, value?: string) =>
  render(<TestNode id="n1" data={nodeData(actionId, value)} {...({} as any)} />);

describe('TestNode value field', () => {
  it('offers the settable states for ensureState instead of asking for them', () => {
    renderNode('ensureState');

    // A combobox, not a text box: the states are the runner's closed list.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the chosen state', () => {
    renderNode('ensureState', 'checked');

    expect(screen.getByRole('combobox')).toHaveTextContent('checked');
  });

  it('keeps a free-text field for a value that is not a closed list', () => {
    // `input` takes whatever the test needs to type. Turning that into a dropdown would be
    // the opposite mistake.
    renderNode('input');

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('draws no value field at all for an action that takes none', () => {
    renderNode('click');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers exactly the states the runner accepts for ensureState', () => {
    // Pinned against the shared table rather than a copy: an action gaining a state the
    // runner understands must not leave the builder unable to offer it.
    expect(ACTION_VALUE_OPTIONS.ensureState).toEqual(SETTABLE_STATES);
    expect(ACTION_VALUE_OPTIONS.ensureState).not.toContain('enabled');
  });
});
