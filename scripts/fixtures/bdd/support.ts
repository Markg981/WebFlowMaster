import { Given } from '@cucumber/cucumber';
Given('TypeScript loaded', function (this: { parameters: Record<string, string> }) {
  if (this.parameters.value !== 'world') throw new Error('Wrong World');
});
