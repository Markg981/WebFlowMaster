import { expect, it } from 'vitest';
import { signTicket, verifyTicket } from './agent-credentials';
const base = { organizationId:1,pool:'bdd',engine:'chromium' as const,headless:true,playwrightVersion:'1.58.0' };
it('validates signed BDD profile identity and forbids mixing native API and BDD sessions', () => {
  const profile = {id:'shop',revision:'rev-1'};
  expect(verifyTicket(signTicket({...base,bddProfile:profile} as any,'secret'),'secret')).toMatchObject({bddProfile:profile});
  expect(verifyTicket(signTicket({...base,bddProfile:{id:'../evil',revision:'rev-1'}} as any,'secret'),'secret')).toMatchObject({error:'malformed ticket'});
  expect(verifyTicket(signTicket({...base,bddProfile:profile,apiProtocol:'grpc'} as any,'secret'),'secret')).toMatchObject({error:'malformed ticket'});
});
