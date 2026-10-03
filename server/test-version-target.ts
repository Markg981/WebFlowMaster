import {
  apiTests,
  mobileTests,
  tests,
  testVersions,
  testReviews,
  testPublications,
} from '@shared/schema';
import type { VersionedTestType } from '@shared/test-versioning';
export function targetTable(type: VersionedTestType) {
  return type === 'api' ? apiTests : type === 'mobile' ? mobileTests : tests;
}
export function targetColumn(
  table: typeof testVersions | typeof testReviews | typeof testPublications,
  type: VersionedTestType,
) {
  return type === 'api' ? table.apiTestId : type === 'mobile' ? table.mobileTestId : table.testId;
}
export function targetValues(type: VersionedTestType, id: number) {
  return {
    testId: type === 'ui' ? id : null,
    apiTestId: type === 'api' ? id : null,
    mobileTestId: type === 'mobile' ? id : null,
  };
}
export function targetOf(row: {
  testId: number | null;
  apiTestId: number | null;
  mobileTestId: number | null;
}): { testType: VersionedTestType; testId: number } {
  if (row.apiTestId !== null) return { testType: 'api', testId: row.apiTestId };
  if (row.mobileTestId !== null) return { testType: 'mobile', testId: row.mobileTestId };
  return { testType: 'ui', testId: row.testId! };
}

export function auditTargetType(type: VersionedTestType): 'test' | 'api_test' | 'mobile_test' {
  return type === 'api' ? 'api_test' : type === 'mobile' ? 'mobile_test' : 'test';
}
