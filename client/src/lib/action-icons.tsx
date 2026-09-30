import {
  Accessibility,
  Activity,
  AppWindow,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  Clock,
  Code,
  Cookie,
  CornerDownLeft,
  Database,
  Eraser,
  Eye,
  Globe,
  Hand,
  Keyboard,
  List,
  ListChecks,
  MessageSquare,
  MousePointer,
  MousePointer2,
  MousePointerClick,
  Move,
  Scroll,
  ToggleRight,
  Type,
  Upload,
  Variable,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { AdhocActionId } from '@shared/recording';

/**
 * The icon for each replay action.
 *
 * This was a `switch` on a free-text icon name with seven cases and a `default`. The action
 * list has grown to fifteen, so the eight it did not name — the conditional waits, the
 * assertions, navigate, the Material dropdown — all fell through to the default and drew the
 * same mouse cursor. In a palette you drag from, an icon that is the same for eight entries
 * is worse than no icon: it says the rows are alike when the whole point is that they differ.
 *
 * Keyed by `AdhocActionId` rather than by the icon string, so an action added to the replay
 * engine without an icon here fails to compile instead of silently drawing a cursor.
 */
const ACTION_ICONS: Record<AdhocActionId, LucideIcon> = {
  click: MousePointer,
  input: Keyboard,
  wait: Clock,
  scroll: Scroll,
  hover: Hand,
  select: ChevronDown,
  selectByText: List,
  navigate: Globe,
  assert: Eye,
  assertTextContains: CheckSquare,
  assertElementCount: ListChecks,
  assertState: ToggleRight,
  ensureState: CheckCheck,
  waitForElement: Eye,
  waitForText: Type,
  waitForNetworkIdle: Activity,
  assertAccessible: Accessibility,
  pressKey: CornerDownLeft,
  doubleClick: MousePointerClick,
  rightClick: MousePointer2,
  dragAndDrop: Move,
  uploadFile: Upload,
  handleDialog: MessageSquare,
  switchTab: AppWindow,
  closeTab: X,
  storeText: Variable,
  setCookie: Cookie,
  clearCookies: Eraser,
  setLocalStorage: Database,
  executeScript: Code,
};

export function ActionIcon({
  action,
  className = 'h-4 w-4',
}: {
  action: string;
  className?: string;
}) {
  const Icon = ACTION_ICONS[action as AdhocActionId] ?? MousePointer;
  return <Icon className={className} aria-hidden />;
}
