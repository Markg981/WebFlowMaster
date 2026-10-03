export type VersionedTestType = 'ui' | 'api' | 'mobile';

export function testRoute(testType: VersionedTestType, id: number) {
  return `/api/${testType === 'ui' ? 'tests' : testType + '-tests'}/${id}`;
}
