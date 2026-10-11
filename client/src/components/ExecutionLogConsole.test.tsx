import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExecutionLogConsole,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
} from './ExecutionLogConsole';

/**
 * A WebSocket the test drives by hand: it records every instance, and the test decides when
 * each one opens, delivers a message or closes.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  /** What the server does, from the socket's point of view. */
  serverOpens() {
    this.onopen?.();
  }
  serverSends(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverDrops() {
    this.onerror?.();
    this.onclose?.();
  }
}

const sockets = () => FakeWebSocket.instances;
const latest = () => sockets()[sockets().length - 1];
const socketState = () => screen.getByTestId('socket-state').getAttribute('data-state');

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ExecutionLogConsole', () => {
  it('subscribes once open and shows the lines the server pushes', async () => {
    render(<ExecutionLogConsole executionId="run-1" />);
    expect(sockets()).toHaveLength(1);
    expect(socketState()).toBe('connecting');

    act(() => latest().serverOpens());
    expect(JSON.parse(latest().sent[0])).toEqual({
      type: 'subscribe-execution',
      executionId: 'run-1',
    });
    expect(socketState()).toBe('connected');

    await act(async () => {
      await Promise.resolve(); // the history fetch settles
    });
    act(() =>
      latest().serverSends({
        type: 'execution-log',
        executionId: 'run-1',
        level: 'info',
        source: 'system',
        message: 'Browser started',
        timestamp: '2026-10-11T10:00:00.000Z',
      }),
    );
    // A line for another run is not this console's business.
    act(() =>
      latest().serverSends({
        type: 'execution-log',
        executionId: 'run-2',
        level: 'info',
        source: 'system',
        message: 'Not mine',
        timestamp: '2026-10-11T10:00:00.000Z',
      }),
    );
    // The rows are virtualized and JSDOM has no layout to place them in; the footer's count is
    // what says which lines the console holds.
    expect(screen.getByText('Showing 1 of 1 logs')).toBeInTheDocument();
  });

  it('reconnects with exponential backoff after a drop, and says so meanwhile', () => {
    render(<ExecutionLogConsole executionId="run-1" />);
    act(() => latest().serverOpens());

    act(() => latest().serverDrops());
    expect(socketState()).toBe('reconnecting');
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(sockets()).toHaveLength(1);

    // First retry after 1 s, not before.
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS - 1));
    expect(sockets()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(sockets()).toHaveLength(2);

    // Second retry after 2 s.
    act(() => latest().serverDrops());
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2 - 1));
    expect(sockets()).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(sockets()).toHaveLength(3);

    // A successful reopen subscribes again and resets the count.
    act(() => latest().serverOpens());
    expect(socketState()).toBe('connected');
    expect(JSON.parse(latest().sent[0]).type).toBe('subscribe-execution');
    act(() => latest().serverDrops());
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS));
    expect(sockets()).toHaveLength(4);
  });

  it('gives up after the bounded number of attempts and shows disconnected', () => {
    render(<ExecutionLogConsole executionId="run-1" />);
    act(() => latest().serverOpens());

    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
      act(() => latest().serverDrops());
      expect(socketState()).toBe('reconnecting');
      act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2 ** attempt));
    }
    expect(sockets()).toHaveLength(1 + RECONNECT_MAX_ATTEMPTS);

    act(() => latest().serverDrops());
    expect(socketState()).toBe('disconnected');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 2 ** RECONNECT_MAX_ATTEMPTS));
    expect(sockets()).toHaveLength(1 + RECONNECT_MAX_ATTEMPTS);
  });

  it('leaves a finished run alone when its socket closes', () => {
    render(<ExecutionLogConsole executionId="run-1" active={false} />);
    act(() => latest().serverOpens());
    act(() => latest().serverDrops());
    expect(socketState()).toBe('disconnected');
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 20));
    expect(sockets()).toHaveLength(1);
  });

  it('closes the socket and cancels a pending retry on unmount', () => {
    const { unmount } = render(<ExecutionLogConsole executionId="run-1" />);
    act(() => latest().serverOpens());
    act(() => latest().serverDrops());
    unmount();
    expect(latest().closed).toBe(true);
    act(() => vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS * 20));
    expect(sockets()).toHaveLength(1);
  });
});
