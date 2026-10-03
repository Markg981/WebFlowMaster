import { integer, jsonb, pgTable, primaryKey, timestamp, text, uuid } from 'drizzle-orm/pg-core';
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

export const widgetConfigSchema = z.object({
  projectId: z.number().int().positive().max(2147483647).optional(),
  days: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  environment: z.string().trim().min(1).max(100).optional(),
}).strict();
export const dashboardWidgetSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(DASHBOARD_WIDGET_IDS), visible: z.boolean(),
  title: z.string().trim().max(100).optional(), width: z.enum(['half', 'full']), config: widgetConfigSchema,
}).strict().superRefine((widget, ctx) => {
  if (widget.config.environment && widget.type !== 'schedules') ctx.addIssue({ code: 'custom', message: 'Environment applies only to schedules', path: ['config', 'environment'] });
  if (widget.config.limit && !['schedules', 'reports'].includes(widget.type)) ctx.addIssue({ code: 'custom', message: 'Limit applies only to schedules and reports', path: ['config', 'limit'] });
  if (widget.config.days && widget.type === 'schedules') ctx.addIssue({ code: 'custom', message: 'Period does not apply to schedules', path: ['config', 'days'] });
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export const dashboardDocumentSchema = z.object({
  name: z.string().trim().min(1).max(100), visibility: z.enum(['private', 'organization']),
  widgets: z.array(dashboardWidgetSchema).max(20).refine(widgets => new Set(widgets.map(w => w.id)).size === widgets.length, 'Instance IDs must be unique'),
}).strict();
export const dashboardUpdateSchema = dashboardDocumentSchema.extend({ version: z.number().int().positive() });
export type DashboardDocument = z.infer<typeof dashboardDocumentSchema>;
export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidget[] = DEFAULT_DASHBOARD_LAYOUT.widgets.map(w => ({
  ...w, type: w.id, width: w.id === 'status' || w.id === 'trend' ? 'half' : 'full', config: {},
}));
export const dashboards = pgTable('dashboards', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  creatorId: integer('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), visibility: text('visibility').$type<DashboardDocument['visibility']>().notNull().default('private'),
  widgets: jsonb('widgets').$type<DashboardWidget[]>().notNull(), version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(), updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
export const userDashboardPreferences = pgTable('user_dashboard_preferences', {
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  selectedDashboardId: uuid('selected_dashboard_id').references(() => dashboards.id, { onDelete: 'set null' }),
  defaultDashboardId: uuid('default_dashboard_id').references(() => dashboards.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.userId] })]);
export type Dashboard = typeof dashboards.$inferSelect & { canManage?: boolean };
