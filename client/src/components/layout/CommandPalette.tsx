import { useEffect, useState, type ElementType } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LogOut, Moon, Play, Search, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { fetchTestPlansAPI } from '@/lib/api/test-plans';

export type PaletteSection = {
  heading: string;
  items: Array<{ href: string; label: string; icon: ElementType }>;
};

type Props = {
  sections: PaletteSection[];
  /** Viewers cannot start a run, so plans are offered only to editors and owners. */
  canRun: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Ctrl+K (⌘K on a Mac) from any page: go to a page, run a plan by name, switch theme, sign out.
 * The same entries as the sidebar, so a page that disappears from it disappears from here too.
 */
export function CommandPalette({ sections, canRun, isDark, onToggleTheme, onLogout }: Props) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fetched when the palette opens, not with every page: most sessions never open it.
  const { data: plans = [] } = useQuery({
    queryKey: ['testPlansSummary'],
    queryFn: fetchTestPlansAPI,
    enabled: open && canRun,
  });

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
        // Named by its visible word, so "click Search" works for speech control; the shortcut
        // hint is drawn by CSS and announced through aria-keyshortcuts instead.
        title={t('commandPalette.open')}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t('commandPalette.search')}</span>
        <kbd
          aria-hidden="true"
          data-keys={isMac ? '⌘K' : 'Ctrl K'}
          className="rounded bg-muted px-1.5 font-mono text-[10px] after:content-[attr(data-keys)]"
        />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title={t('commandPalette.title')}>
        <CommandInput placeholder={t('commandPalette.placeholder')} />
        <CommandList>
          <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
          {sections.map((section) => (
            <CommandGroup key={section.heading} heading={section.heading}>
              {section.items.map(({ href, label, icon: Icon }) => (
                <CommandItem
                  key={href}
                  value={`${section.heading} ${label}`}
                  onSelect={() => run(() => navigate(href))}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {canRun && plans.length > 0 && (
            <CommandGroup heading={t('commandPalette.plans')}>
              {plans.map((plan) => (
                <CommandItem
                  key={plan.id}
                  value={`${t('commandPalette.runPlan')} ${plan.name} ${plan.id}`}
                  onSelect={() => run(() => navigate(`/test-plan/${plan.id}/run`))}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {t('commandPalette.runPlanNamed', { name: plan.name })}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading={t('commandPalette.actions')}>
            <CommandItem onSelect={() => run(() => navigate('/settings'))}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate('/whats-new'))}>
              <Sparkles className="mr-2 h-4 w-4" />
              {t('whatsNew.title', 'What’s new')}
            </CommandItem>
            <CommandItem onSelect={() => run(onToggleTheme)}>
              {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {isDark
                ? t('common.lightMode', 'Switch to light mode')
                : t('common.darkMode', 'Switch to dark mode')}
            </CommandItem>
            <CommandItem onSelect={() => run(onLogout)}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('common.logout', 'Log out')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
