import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationEditor } from './ConversationEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string, options?: Record<string, unknown>) => fallback.replace(/{{(\w+)}}/g, (match, key: string) => String(options?.[key] ?? match)) }) }));
function Harness({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial);
  return <><ConversationEditor value={body} onChange={setBody} /><output data-testid="body">{body}</output></>;
}
describe('ConversationEditor', () => {
  it('keeps legacy raw text unchanged until explicitly creating a conversation', () => {
    render(<Harness initial={'first\nsecond'} />);
    expect(screen.getByTestId('body')).toHaveTextContent('first second');
    expect(screen.queryByLabelText('Step 1 message')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    expect(JSON.parse(screen.getByTestId('body').textContent!)).toEqual({ steps: [{ type: 'receive' }] });
  });
  it('edits ordered receive/capture/send steps with lazy placeholders', () => {
    render(<Harness initial={JSON.stringify({ steps: [{ type: 'receive' }, { type: 'capture', name: 'token', property: 'token' }, { type: 'send', message: '{{capture.token}}' }] })} />);
    expect(screen.getByLabelText('Step 3 message')).toHaveValue('{{capture.token}}');
    fireEvent.change(screen.getByLabelText('Step 2 capture name'), { target: { value: 'challenge' } });
    expect(JSON.parse(screen.getByTestId('body').textContent!).steps[1].name).toBe('challenge');
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('body').textContent!).steps[1].type).toBe('send');
  });
  it('provides JSON fallback for malformed plans without discarding the draft', () => {
    render(<Harness initial={'{"steps":['} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit conversation JSON' }));
    expect(screen.getByLabelText('Conversation JSON')).toHaveValue('{"steps":[');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
