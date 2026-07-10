import { v4 as uuidv4 } from 'uuid';
import type { InsertApiTest } from '@shared/schema';
import type { Endpoint } from './types';

export interface MapperConfig {
  baseUrlVar: string; // e.g. "{{baseUrl}}"
  projectId: number;
  userId: number;
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

function featureAreaFromRoute(route: string): string {
  const parts = route.split('/').filter(Boolean);
  // "api/NetContentTareCheck/Action" -> "NetContentTareCheck"
  return parts.length >= 2 ? parts[1] : (parts[0] ?? '');
}

export function mapEndpoint(ep: Endpoint, cfg: MapperConfig): InsertApiTest {
  const queryParams: KeyValuePair[] = ep.params.map((p) => ({
    id: uuidv4(),
    key: p.name,
    value: p.required ? '' : (p.defaultValue ?? ''),
    enabled: p.required, // required params on by default (user fills them); optional off
  }));

  const assertions = [
    {
      id: uuidv4(),
      source: 'status_code' as const,
      comparison: 'less_than' as const,
      targetValue: '500',
      enabled: true,
    },
  ];

  return {
    userId: cfg.userId,
    projectId: cfg.projectId,
    name: ep.action,
    method: ep.httpMethod,
    url: `${cfg.baseUrlVar}/${ep.route}`,
    queryParams,
    requestHeaders: null,
    requestBody: null,
    assertions,
    authType: null,
    authParams: null,
    bodyType: 'none',
    module: ep.controller,
    featureArea: featureAreaFromRoute(ep.route),
    priority: 'Medium',
    severity: 'Major',
  } as InsertApiTest;
}

export function mapEndpoints(eps: Endpoint[], cfg: MapperConfig): InsertApiTest[] {
  return eps.map((ep) => mapEndpoint(ep, cfg));
}
