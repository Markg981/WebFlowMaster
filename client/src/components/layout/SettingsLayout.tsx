import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Two panes: the sections on the left, one section's content on the right.
 *
 * Settings was nine cards stacked in one 845px column, about three screens tall, with no
 * way to see what else was there or to get to it other than scrolling past everything in
 * between. Nothing told you the page had an Environments card below the fold, and a link to
 * "create an environment in Settings" landed you at the top with no idea where to look.
 *
 * A rail costs one glance and answers both: what this page holds, and where you are in it.
 * The active section lives in the URL fragment, so a link can point straight at one and a
 * reload puts you back where you were.
 */

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Shown under the section title in the right pane. */
  description?: string;
  content: React.ReactNode;
  /** Rendered at the foot of this section only — a save bar that applies to its fields. */
  footer?: React.ReactNode;
}

export interface SettingsLayoutProps {
  sections: SettingsSection[];
  header?: React.ReactNode;
  /** Accessible name for the section rail, e.g. "Settings sections". */
  navLabel: string;
}

/** The section named by the URL fragment, falling back to the first one. */
function useActiveSection(sections: SettingsSection[]): [string, (id: string) => void] {
  const read = React.useCallback(() => {
    const fromHash = window.location.hash.replace(/^#/, '');
    return sections.some((section) => section.id === fromHash) ? fromHash : sections[0].id;
  }, [sections]);

  const [active, setActive] = React.useState(read);

  // The back button should move between sections, since the fragment is what changed.
  React.useEffect(() => {
    const onHashChange = () => setActive(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [read]);

  const select = React.useCallback((id: string) => {
    window.location.hash = id;
    setActive(id);
  }, []);

  return [active, select];
}

export function SettingsLayout({ sections, header, navLabel }: SettingsLayoutProps) {
  const [active, select] = useActiveSection(sections);
  const current = sections.find((section) => section.id === active) ?? sections[0];

  return (
    <div className="mx-auto max-w-6xl p-6">
      {header}

      <div className="mt-6 flex flex-col gap-6 md:flex-row md:gap-8">
        {/* On a phone the rail becomes a strip that scrolls sideways, so the sections stay
            reachable without pushing the content itself off the screen. */}
        <nav
          aria-label={navLabel}
          className={cn(
            'flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-56 md:flex-col md:overflow-visible md:pb-0',
            'md:sticky md:top-20 md:self-start',
          )}
        >
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === current.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => select(section.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{section.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">{current.label}</h2>
            {current.description && (
              <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
            )}
          </div>

          <div className="space-y-6">{current.content}</div>

          {current.footer && <div className="mt-6">{current.footer}</div>}
        </div>
      </div>
    </div>
  );
}
