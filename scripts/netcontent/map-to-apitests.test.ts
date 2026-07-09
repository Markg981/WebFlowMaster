import { describe, it, expect } from 'vitest';
import { mapEndpoint } from './map-to-apitests';
import type { Endpoint } from './types';

const ep: Endpoint = {
  httpMethod: 'POST',
  route: 'api/NetContentTareCheck/UpdateMeasurement',
  controller: 'TareCheck',
  action: 'UpdateMeasurement',
  params: [
    { name: 'valueRowId', csType: 'int', required: true, defaultValue: null },
    { name: 'isManual', csType: 'bool', required: false, defaultValue: 'false' },
  ],
};

describe('mapEndpoint', () => {
  const cfg = { baseUrlVar: '{{baseUrl}}', projectId: 7, userId: 3 };

  it('maps method, url, module, featureArea, owner and project', () => {
    const t = mapEndpoint(ep, cfg);
    expect(t.method).toBe('POST');
    expect(t.url).toBe('{{baseUrl}}/api/NetContentTareCheck/UpdateMeasurement');
    expect(t.name).toBe('UpdateMeasurement');
    expect(t.module).toBe('TareCheck');
    expect(t.featureArea).toBe('NetContentTareCheck');
    expect(t.projectId).toBe(7);
    expect(t.userId).toBe(3);
    expect(t.bodyType).toBe('none');
    expect(t.authType).toBeNull();
  });

  it('maps params to queryParams: required enabled+empty, optional disabled+default', () => {
    const t = mapEndpoint(ep, cfg);
    const qp = t.queryParams as Array<{ key: string; value: string; enabled: boolean }>;
    expect(qp).toHaveLength(2);
    expect(qp[0]).toMatchObject({ key: 'valueRowId', value: '', enabled: true });
    expect(qp[1]).toMatchObject({ key: 'isManual', value: 'false', enabled: false });
  });

  it('adds the default status_code < 500 smoke assertion', () => {
    const t = mapEndpoint(ep, cfg);
    const a = (t.assertions as Array<any>)[0];
    expect(a).toMatchObject({ source: 'status_code', comparison: 'less_than', targetValue: '500', enabled: true });
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
  });
});
