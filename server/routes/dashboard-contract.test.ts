import { describe, expect, it } from 'vitest';
import { dashboardDocumentSchema, DEFAULT_DASHBOARD_WIDGETS } from '@shared/dashboard-layout';

describe('configurable dashboards', () => {
  it('allows several instances of the same type with independent settings', () => {
    expect(dashboardDocumentSchema.parse({ name: 'Team', visibility: 'organization', widgets: [
      { id: 'one', type: 'trend', visible: true, width: 'half', config: { projectId: 1, days: 365 } },
      { id: 'two', type: 'trend', visible: false, width: 'full', config: { days: 1 } },
    ] }).widgets).toHaveLength(2);
  });
  it.each([
    [{ ...DEFAULT_DASHBOARD_WIDGETS?.[0], config: { days: 366 } }],
    [{ ...DEFAULT_DASHBOARD_WIDGETS?.[0], config: { limit: 51 } }],
    [{ ...DEFAULT_DASHBOARD_WIDGETS?.[0], config: { environment: 'prod' } }],
    Array.from({ length: 21 }, (_, i) => ({ ...DEFAULT_DASHBOARD_WIDGETS?.[0], id: String(i) })),
    [{ ...DEFAULT_DASHBOARD_WIDGETS?.[0] }, { ...DEFAULT_DASHBOARD_WIDGETS?.[0] }],
  ].map(widgets => [widgets]))('rejects invalid instances %j', widgets => {
    expect(dashboardDocumentSchema.safeParse({ name: 'Team', visibility: 'private', widgets }).success).toBe(false);
  });
});
