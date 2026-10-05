import { expect, it } from 'vitest';
import { snapshotOf, describeChange } from './test-versions';
import { exportBundle, parseBundle } from './test-bundle';
const bdd = { language:'en',source:'Feature: F\nScenario: S\nGiven a',uri:'test.feature',scenarioLine:2,mode:'manual' as const };
const test = { name:'BDD',url:'',sequence:[{id:'s',action:{id:'manualStep',name:'Manual'},value:'Given a',expected:''}],elements:[],bdd };
it('keeps BDD source and binding in version snapshots and change summaries',() => {
  expect((snapshotOf(test) as any).bdd).toEqual(bdd);
  expect(describeChange({...snapshotOf(test),bdd} as any,{...snapshotOf(test),bdd:{...bdd,source:bdd.source+' changed'}} as any)).toMatch(/BDD/i);
});
it('exports and reimports BDD configuration through portable JSON bundles',() => {
  const file = exportBundle({project:'BDD',tests:[test as any],apiTests:[]},'json');
  expect(parseBundle(file.content).tests[0].bdd).toEqual(bdd);
});
