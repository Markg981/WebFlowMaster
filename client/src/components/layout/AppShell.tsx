import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Network, PlusSquare, FileSpreadsheet, ListChecks,
  CalendarClock, FileText, Settings as SettingsIcon, PanelLeftClose,
  PanelLeftOpen, Sun, Moon, LogOut, Menu, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

type NavItem = { href: string; label: string; icon: React.ElementType; exact?: boolean };
type NavSection = { heading: string; items: NavItem[] };

const COLLAPSE_KEY = 'wfm.sidebar.collapsed';

function useNav(): NavSection[] {
  const { t } = useTranslation();
  return [
    {
      heading: t('nav.section.testing', 'Testing'),
      items: [
        { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, exact: true },
        { href: '/dashboard/api-tester', label: t('nav.apiTester', 'API Tester'), icon: Network },
        { href: '/dashboard/create-test', label: t('nav.createTest'), icon: PlusSquare },
        { href: '/test-manager', label: t('nav.testManager', 'Test Manager'), icon: FileSpreadsheet },
        { href: '/test-suites', label: t('nav.suites'), icon: ListChecks },
      ],
    },
    {
      heading: t('nav.section.operations', 'Operations'),
      items: [
        { href: '/scheduling', label: t('nav.scheduling', 'Scheduling'), icon: CalendarClock },
        { href: '/reports', label: t('nav.reports'), icon: FileText },
      ],
    },
  ];
}

function isActive(location: string, item: NavItem): boolean {
  return item.exact ? location === item.href : location === item.href || location.startsWith(item.href + '/');
}

/** Page title shown in the topbar, derived from the active route. */
function pageTitle(location: string, sections: NavSection[], settingsLabel: string): string {
  for (const s of sections) for (const it of s.items) if (isActive(location, it)) return it.label;
  if (location.startsWith('/settings')) return settingsLabel;
  if (location.includes('/executions/')) return 'Execution report';
  if (location.includes('/run')) return 'Run test plan';
  return 'WebTest Platform';
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

function persistTheme(theme: 'light' | 'dark') {
  // Best-effort: the toggle takes effect immediately regardless of the network call.
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}

const SidebarNav: React.FC<{ collapsed: boolean; onNavigate?: () => void }> = ({ collapsed, onNavigate }) => {
  const sections = useNav();
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          {!collapsed && (
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.heading}
            </div>
          )}
          {section.items.map((item) => {
            const active = isActive(location, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
};

const Brand: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <div className={cn('flex items-center gap-2.5 px-2 py-1', collapsed && 'justify-center px-0')}>
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 shadow-sm ring-1 ring-inset ring-white/15">
      <span className="font-mono text-[13px] font-bold text-primary-foreground">W</span>
    </div>
    {!collapsed && (
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-tight tracking-tight">WebTest Platform</div>
        <div className="truncate text-[11px] font-medium text-muted-foreground">DMO · QA Platform</div>
      </div>
    )}
  </div>
);

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const sections = useNav();

  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Keep the toggle icon in sync if the theme is changed elsewhere (e.g. Settings page).
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next);
    persistTheme(next ? 'dark' : 'light');
  };

  const initials = (user?.username ?? '?').replace(/@.*/, '').slice(0, 2).toUpperCase();

  const sidebarInner = (
    <div className="flex h-full flex-col gap-4 p-3">
      <Brand collapsed={collapsed} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
      </div>
      <Link
        href="/settings"
        title={collapsed ? t('nav.settings') : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          location.startsWith('/settings')
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <SettingsIcon className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span>{t('nav.settings')}</span>}
      </Link>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 ease-out md:block',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        {sidebarInner}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 border-r border-border bg-card shadow-md">
            <div className="flex justify-end p-2">
              <button
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setMobileOpen(false)}
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t('common.menu', 'Open menu')}
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? t('common.expandSidebar', 'Expand sidebar') : t('common.collapseSidebar', 'Collapse sidebar')}
            >
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
            <div className="min-w-0 truncate text-sm">
              <span className="text-muted-foreground">DMO</span>
              <span className="mx-1.5 text-border">/</span>
              <span className="font-semibold text-foreground">{pageTitle(location, sections, t('nav.settings'))}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={isDark ? t('common.lightMode', 'Switch to light mode') : t('common.darkMode', 'Switch to dark mode')}
            >
              {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-accent"
                  aria-label={t('common.account', 'Account')}
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                    {initials}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col">
                  <span className="text-sm font-semibold">{user?.username}</span>
                  <span className="text-xs font-normal text-muted-foreground">{t('common.signedIn', 'Signed in')}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <Link href="/settings">
                  <DropdownMenuItem className="cursor-pointer">
                    <SettingsIcon className="mr-2 h-4 w-4" />
                    {t('nav.settings')}
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => logoutMutation.mutate()}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('common.logout', 'Log out')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};

export default AppShell;
