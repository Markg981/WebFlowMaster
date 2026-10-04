import { expect, it } from 'vitest';
import { BddAgentProfileSchema, BddAgentRequestSchema } from '@shared/bdd-agent';
it('rejects executable paths, unbounded requests and tenant-supplied commands', () => {
  expect(BddAgentProfileSchema.safeParse({ id:'../code', label:'Unsafe', provider:'cucumber-js',revision:'rev',maxDurationMs:60000 }).success).toBe(false);
  const request = { source:'Feature: F\nScenario: S\nGiven a', uri:'test.feature',scenarioLine:2,profile:{id:'shop',revision:'rev'},variables:{},timeoutMs:60000 };
  expect(BddAgentRequestSchema.parse(request)).toEqual(request);
  expect(BddAgentRequestSchema.safeParse({...request,command:'node arbitrary.js'}).success).toBe(false);
  expect(BddAgentRequestSchema.safeParse({...request,timeoutMs:300001}).success).toBe(false);
});
