import {expect,it} from 'vitest';
import {manualStepsOf} from '@shared/manual-tests';
import {parseGherkin} from './gherkin';
it('retains structured Gherkin arguments in manual run evidence',() => {
  const parsed=parseGherkin('Feature: F\nScenario: S\nGiven payload\n  """text/plain\n  <payload>\n  """\nWhen rows\n  | name | value |\n  | x | y |');
  expect(manualStepsOf(parsed.tests[0].sequence)).toMatchObject([
    {gherkin:{docString:{mediaType:'text/plain',content:'<payload>'}}},
    {gherkin:{dataTable:{rows:[{cells:[{value:'name'},{value:'value'}]},{cells:[{value:'x'},{value:'y'}]}]}}},
  ]);
});
