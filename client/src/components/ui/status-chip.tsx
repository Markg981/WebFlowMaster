import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * StatusChip — the single, consistent way execution/test state is shown across the app.
 * A monospace dot+label so status reads the same on the dashboard, in tables, and reports.
 */
type Tone = 'pass' | 'fail' | 'warn' | 'run' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  pass: 'bg-success/12 text-success',
  fail: 'bg-destructive/12 text-destructive',
  warn: 'bg-warning/15 text-warning',
  run: 'bg-primary/12 text-primary',
  neutral: 'bg-muted text-muted-foreground',
};

const DOT_CLASS: Record<Tone, string> = {
  pass: 'bg-success',
  fail: 'bg-destructive',
  warn: 'bg-warning',
  run: 'bg-primary motion-safe:animate-pulse',
  neutral: 'bg-muted-foreground',
};

// Normalizes the many status strings the API uses onto the four meaningful tones + neutral.
const STATUS_TONE: Record<string, Tone> = {
  passed: 'pass', pass: 'pass', completed: 'pass', success: 'pass',
  failed: 'fail', fail: 'fail', error: 'fail',
  blocked: 'warn', warning: 'warn', flaky: 'warn',
  running: 'run', 'in_progress': 'run', in_progress2: 'run',
  pending: 'neutral', queued: 'neutral', skipped: 'neutral', cancelled: 'neutral', canceled: 'neutral',
};

export function statusTone(status?: string | null): Tone {
  return STATUS_TONE[(status ?? '').toLowerCase()] ?? 'neutral';
}

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: string | null;
  /** Override the derived tone. */
  tone?: Tone;
  /** Override the label (defaults to the uppercased status). */
  label?: string;
}

export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  ({ status, tone, label, className, ...props }, ref) => {
    const t = tone ?? statusTone(status);
    const text = (label ?? status ?? 'unknown').toUpperCase();
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex h-[22px] items-center gap-1.5 rounded-md pl-1.5 pr-2 font-mono text-[11px] font-semibold tracking-wide',
          TONE_CLASS[t],
          className,
        )}
        {...props}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[t])} />
        {text}
      </span>
    );
  },
);
StatusChip.displayName = 'StatusChip';
