import { integer, jsonb, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { organizations, users } from './schema';

export const DASHBOARD_WIDGET_IDS = ['kpis', 'status', 'trend', 'schedules', 'reports'] as const;
export type DashboardWidgetId = typeof DASHBOARD_WIDGET_IDS[number];
export const dashboardLayoutSchema = z.object({
  widgets: z.array(z.object({ id: z.enum(DASHBOARD_WIDGET_IDS), visible: z.boolean() }).strict())
    .length(DASHBOARD_WIDGET_IDS.length)
    .refine(widgets => new Set(widgets.map(w => w.id)).size === DASHBOARD_WIDGET_IDS.length, 'Widgets must occur exactly once'),
}).strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  widgets: DASHBOARD_WIDGET_IDS.map(id => ({ id, visible: true })),
};

export const userDashboardLayouts = pgTable('user_dashboard_layouts', {
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  widgets: jsonb('widgets').$type<DashboardLayout['widgets']>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.userId] })]);
