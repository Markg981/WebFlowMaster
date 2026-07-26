import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecordingSession } from './useRecordingSession';
import type { RecordedAction } from '@shared/recording';

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

// The hook only needs mutate/isPending, so a tiny stand-in keeps the test free of a
// QueryClientProvider wrapper.
vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: any) => ({
    isPending: false,
    mutate: async (variables: any) => {
      try {
        const data = await options.mutationFn(variables);
        options.onSuccess?.(data);
      } catch (error) {
        options.onError?.(error);
      } finally {
        options.onSettled?.();
      }
    },
  }),
}));

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

const recorded = (overrides: Partial<RecordedAction>): RecordedAction => ({
  type: 'click',
  timestamp: 1,
  ...overrides,
});

function setup() {
  const onStepsChange = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(() =>
    useRecordingSession({ onStepsChange, onError, onNotice }),
  );
  return { ...hook, onStepsChange, onError, onNotice };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRecordingSession', () => {
  it('starts a session and immediately polls for the buffer', async () => {
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      return jsonResponse({
        success: true,
        sequence: [recorded({ type: 'click', selector: '#login' })],
      });
    });

    const { result, onStepsChange } = setup();

    await act(async () => {
      result.current.start('https://app.test');
    });

    await waitFor(() => expect(result.current.isRecording).toBe(true));
    await waitFor(() => expect(onStepsChange).toHaveBeenCalled());

    const steps = onStepsChange.mock.calls.at(-1)![0];
    expect(steps).toHaveLength(1);
    expect(steps[0].action.id).toBe('click');
    expect(steps[0].targetElement.selector).toBe('#login');
  });

  it('reads the buffer from `sequence`, the field the server actually sends', async () => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      // The pre-fix server shape. Nothing must be mapped out of it.
      return jsonResponse({ success: true, actions: [recorded({ selector: '#nope' })] });
    });

    const { result, onStepsChange } = setup();
    await act(async () => {
      result.current.start('https://app.test');
    });
    await waitFor(() => expect(result.current.isRecording).toBe(true));

    expect(onStepsChange).not.toHaveBeenCalled();
  });

  it('does not re-emit steps when the buffer is unchanged', async () => {
    const sequence = [recorded({ type: 'click', selector: '#login' })];
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      return jsonResponse({ success: true, sequence });
    });

    const { result, onStepsChange } = setup();
    await act(async () => {
      result.current.start('https://app.test');
    });
    await waitFor(() => expect(onStepsChange).toHaveBeenCalledTimes(1));

    // Several more polls with the same buffer must stay silent.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onStepsChange).toHaveBeenCalledTimes(1);
  });

  it('stops polling and notifies when the browser window was closed', async () => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      return jsonResponse({
        success: true,
        sequence: [recorded({ selector: '#login' })],
        sessionEnded: true,
        error: 'The recording browser window was closed.',
      });
    });

    const { result, onNotice } = setup();
    await act(async () => {
      result.current.start('https://app.test');
    });

    await waitFor(() => expect(result.current.isRecording).toBe(false));
    expect(onNotice).toHaveBeenCalledWith(
      'recording.sessionEnded',
      'The recording browser window was closed.',
    );
    expect(result.current.sessionId).toBeNull();
  });

  it('keeps the captured buffer when a poll fails', async () => {
    let pollCount = 0;
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({ success: true, sequence: [recorded({ selector: '#login' })] });
      }
      throw new Error('network down');
    });

    const { result, onStepsChange } = setup();
    await act(async () => {
      result.current.start('https://app.test');
    });
    await waitFor(() => expect(onStepsChange).toHaveBeenCalledTimes(1));

    await new Promise((resolve) => setTimeout(resolve, 50));
    // The failed poll must not have emitted an empty sequence.
    expect(onStepsChange).toHaveBeenCalledTimes(1);
    expect(result.current.recordedActions).toHaveLength(1);
  });

  it('maps the final sequence on stop, including recorded assertions', async () => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url === '/api/start-recording') {
        return jsonResponse({ success: true, sessionId: 'sess-1' });
      }
      if (url === '/api/stop-recording') {
        return jsonResponse({
          success: true,
          sequence: [
            recorded({ type: 'navigate', url: 'https://app.test', meta: 'session-started' }),
            recorded({ type: 'click', selector: '#login' }),
            recorded({ type: 'assertTextContains', selector: 'h1', value: 'Welcome' }),
            recorded({ type: 'navigate', url: 'https://app.test', meta: 'session-stopped' }),
          ],
        });
      }
      return jsonResponse({ success: true, sequence: [] });
    });

    const { result, onStepsChange } = setup();
    await act(async () => {
      result.current.start('https://app.test');
    });
    await waitFor(() => expect(result.current.isRecording).toBe(true));

    await act(async () => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.isRecording).toBe(false));

    const steps = onStepsChange.mock.calls.at(-1)![0];
    expect(steps.map((s: any) => s.action.id)).toEqual(['click', 'assertTextContains']);
    expect(steps[1].value).toBe('Welcome');
  });
});
