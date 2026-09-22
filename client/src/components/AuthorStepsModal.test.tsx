import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuthorStepsModal, { describeStep } from './AuthorStepsModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

/**
 * Describing the test instead of performing it.
 *
 * The preview is the whole safeguard: a sentence read the wrong way becomes a test that passes
 * for a reason nobody intended, and this is the only moment anyone can catch it. So what these
 * hold is that nothing reaches the builder unseen, and that a line which could not be read is
 * shown with its reason rather than quietly missing from the list.
 */

const fetchMock = vi.fn();

const step = (id: string, selector: string) => ({
  id: `step-${id}`,
  action: { id, type: id, name: `actions.${id}.name`, icon: 'x', description: 'd' },
  targetElement: { id: 'D1', type: 'button', selector, text: 'Save', tag: 'button', attributes: {} },
});

const authoringResponse = {
  steps: [
    { line: 1, text: 'Click the Save button', source: 'pattern', step: step('click', '#save') },
    { line: 2, text: 'Put the order through', source: 'model', step: step('click', '#submit') },
  ],
  unresolved: [{ line: 3, text: 'Do the needful', reason: 'Nothing here is called "the needful".' }],
  usedModel: true,
  modelAvailable: true,
  catalogue: { repository: [], detected: 2 },
};

function renderModal(props: Partial<React.ComponentProps<typeof AuthorStepsModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const merged = {
    isOpen: true,
    onClose: vi.fn(),
    elements: [{ id: 'd1', selector: '#save', tag: 'button', text: 'Save', attributes: {} }],
    onInsert: vi.fn(),
    ...props,
  };
  render(
    <QueryClientProvider client={client}>
      <AuthorStepsModal {...merged} />
    </QueryClientProvider>,
  );
  return merged;
}

async function readDescription(text = 'Click the Save button') {
  fireEvent.change(screen.getByTestId('author-steps-text'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /Read the description/i }));
  await screen.findByTestId('author-steps-preview');
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, json: async () => [{ id: 7, name: 'Shop' }] });
    }
    return Promise.resolve({ ok: true, json: async () => authoringResponse });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('describeStep', () => {
  it('says what a step does without making anyone open it', () => {
    const described = describeStep(
      { ...step('input', '#user'), value: 'mario' } as any,
      (_key, fallback) => fallback,
    );

    expect(described).toBe('input · Save · "mario"');
  });
});

describe('AuthorStepsModal', () => {
  it('sends the page’s elements, so a sentence can only name something that exists', async () => {
    renderModal();
    await readDescription();

    const [, request] = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/authoring/steps'))!;
    expect(JSON.parse(request.body).elements).toHaveLength(1);
    expect(JSON.parse(request.body).text).toBe('Click the Save button');
  });

  it('shows every line as what it became, and names the one it could not read', async () => {
    renderModal();
    await readDescription();

    // Inside the preview: the textarea still holds the same sentence, and what is being
    // checked here is what came back, not what was typed.
    const preview = within(screen.getByTestId('author-steps-preview'));
    expect(preview.getByText('Click the Save button')).toBeInTheDocument();
    expect(preview.getByText('Do the needful')).toBeInTheDocument();
    expect(preview.getByText(/Nothing here is called/)).toBeInTheDocument();
  });

  it('marks the steps a model proposed, so they get read twice', async () => {
    renderModal();
    await readDescription();

    expect(screen.getAllByText('AI')).toHaveLength(1);
  });

  it('inserts nothing until the author has seen it', async () => {
    const { onInsert } = renderModal();

    expect(screen.getByRole('button', { name: /Insert/i })).toBeDisabled();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('hands the builder the steps, once', async () => {
    const { onInsert, onClose } = renderModal();
    await readDescription();

    fireEvent.click(screen.getByRole('button', { name: /Insert 2 steps/i }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0]).toHaveLength(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a refusal instead of an empty preview', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/projects')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: false, json: async () => ({ error: 'Could not read those instructions.' }) });
    });
    renderModal();

    fireEvent.change(screen.getByTestId('author-steps-text'), { target: { value: 'Click Save' } });
    fireEvent.click(screen.getByRole('button', { name: /Read the description/i }));

    expect(await screen.findByText('Could not read those instructions.')).toBeInTheDocument();
    expect(screen.queryByTestId('author-steps-preview')).not.toBeInTheDocument();
  });

  it('says when only the built-in phrasings were available', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/projects')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...authoringResponse, usedModel: false, modelAvailable: false }),
      });
    });
    renderModal();
    await readDescription();

    expect(screen.getByText(/No AI key is configured/)).toBeInTheDocument();
  });
});
