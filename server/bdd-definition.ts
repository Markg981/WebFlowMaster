import type { BddTest } from '@shared/bdd';
import type { TenantTx } from './middleware/tenancy';
import { parseGherkin, validateBddTest } from './gherkin';
import { resolveBddBinding } from './bdd-profiles';

export class BddDefinitionError extends Error {}
export async function prepareBddForSave<T extends {bdd?: BddTest | null;sequence?: unknown;projectId?: number | null}>(tx:TenantTx,input:T,existing?:{bdd?:BddTest|null;projectId:number|null}) :Promise<T> {
  try {
    if (existing?.bdd && input.bdd === undefined && input.sequence !== undefined) throw new Error('Edit the Gherkin source or explicitly remove BDD mode before changing browser/manual steps.');
    const bdd = input.bdd === undefined ? existing?.bdd : input.bdd;
    if (!bdd) return input;
    const valid = validateBddTest(bdd);
    await resolveBddBinding(tx,valid,input.projectId === undefined ? existing?.projectId ?? null : input.projectId);
    const parsed = parseGherkin(valid.source,{mode:valid.mode,binding:valid.binding});
    const selected = parsed.tests.find(test => {
      const definition = test.bdd as BddTest | undefined;
      return definition?.scenarioLine === valid.scenarioLine && definition.exampleLine === valid.exampleLine;
    });
    if (!selected) throw new Error('The source does not contain the selected BDD scenario.');
    return {...input,bdd:valid,sequence:selected.sequence};
  } catch(error) { throw new BddDefinitionError((error as Error).message); }
}
