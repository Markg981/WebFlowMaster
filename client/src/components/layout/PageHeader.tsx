import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The heading every page opens with.
 *
 * Seven pages had hand-copied the same three lines, and each of them stacked an eyebrow over
 * a title that said the same thing — "OVERVIEW" above "Dashboard Overview" — under a
 * breadcrumb that had already said it a third time. An eyebrow earns its place when it names
 * the group a page belongs to; repeating the title in smaller capitals is decoration.
 *
 * What the eyebrow occupied is worth more as a description: one line saying what the page is
 * for, which is what a person opening it for the first time actually needs.
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  /** One line on what this page is for. Skip it where the title is self-evident. */
  description?: React.ReactNode;
  /** Buttons and fields belonging to the page as a whole. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
