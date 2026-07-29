import React from 'react';
import { reportClientIncident } from './install';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes, reports them as incidents, and shows a plain fallback.
 *
 * Without this a thrown render unmounts the whole tree and leaves a blank page with no
 * trace anywhere — the single largest blind spot in the app before this work.
 */
export class ObservabilityErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportClientIncident({
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="m-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
      >
        <p className="font-semibold">Something went wrong on this page.</p>
        <p className="mt-1 text-sm">The error has been recorded. Reload the page to continue.</p>
        <pre className="mt-3 max-h-40 overflow-auto text-xs opacity-80">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}
