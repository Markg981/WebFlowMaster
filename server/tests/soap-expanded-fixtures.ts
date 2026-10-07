import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(new URL(`../../collaudo/fixtures/wsdl/${name}`, import.meta.url), 'utf8');

// Representative synthetic contract, shared with manual acceptance. No client provenance.
export const expandedWsdl = fixture('service.wsdl');
export const expandedDocuments = ['request.xsd', 'common.xsd'].map((location) => ({
  location,
  content: fixture(location),
}));
