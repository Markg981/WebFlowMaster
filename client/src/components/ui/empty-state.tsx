import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * What a panel shows when it has nothing to show.
 *
 * The dashboard used to answer with a single grey sentence in the middle of 300px of
 * nothing — "No test executions found." — which is the first thing a new user sees after
 * signing in, and it is a dead end: true, unhelpful, and offering no way out. An empty
 * panel is the one moment when the product knows exactly what the person should do next,
 * so it says that and puts the control to do it within reach.
 *
 * `title` names the situation, `description` explains it in one line, `action` is the way
 * forward. A panel whose emptiness has no useful action — because a sibling panel already
 * offers it — passes no action rather than repeating the same button twice on one screen.
 */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Tighter spacing, for a panel that has to fit inside a fixed-height chart card. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      {Icon && (
        <div className={cn('rounded-full bg-muted', compact ? 'p-2' : 'p-3')}>
          <Icon
            className={cn('text-muted-foreground', compact ? 'h-5 w-5' : 'h-6 w-6')}
            aria-hidden
          />
        </div>
      )}
      <div>
        <p className={cn('font-medium', compact && 'text-sm')}>{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className={cn(compact ? 'mt-0.5' : 'mt-1')}>{action}</div>}
    </div>
  );
}
