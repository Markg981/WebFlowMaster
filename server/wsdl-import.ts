import { randomUUID } from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import type { ImportedApiTest, ImportResult, ImportVariable } from './api-import';
import { ImportError, MAX_IMPORTED_TESTS } from './api-import';

/**
 * A SOAP service's WSDL (1.1) as API tests (server/api-import.ts): one POST per operation of the
 * service's SOAP binding — 1.1 when it has one, 1.2 otherwise — with the envelope, the SOAPAction,
 * and the request element written out from the schema, its fields as `?` to fill in, as SoapUI
 * does. Each test expects 200 and no SOAP Fault in the answer.
 *
 * The address starts from {{baseUrl}}, like the OpenAPI import, with the service's own address
 * suggested for it.
 */

const WSDL = 'http://schemas.xmlsoap.org/wsdl/';
const SOAP11 = 'http://schemas.xmlsoap.org/wsdl/soap/';
const SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';
const XSD = 'http://www.w3.org/2001/XMLSchema';

type El = Element;

const children = (el: El | null | undefined, ns: string, name: string): El[] =>
  el ? Array.from(el.childNodes as unknown as ArrayLike<Node>).filter((n): n is El => n.nodeType === 1 && (n as El).namespaceURI === ns && (n as El).localName === name) : [];
const child = (el: El | null | undefined, ns: string, name: string): El | null => children(el, ns, name)[0] ?? null;
const localOf = (qname: string | null) => (qname ?? '').split(':').pop() ?? '';

/** The namespace a prefixed name (tns:GetOrder) points at, looked up from the element outwards. */
function namespaceOf(el: El, qname: string): string | null {
  const prefix = qname.includes(':') ? qname.split(':')[0] : '';
  let node: El | null = el;
  while (node && node.nodeType === 1) {
    const value = node.getAttribute(prefix ? `xmlns:${prefix}` : 'xmlns');
    if (value) return value;
    node = node.parentNode as El | null;
  }
  return null;
}

export function looksLikeWsdl(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<([\w-]+:)?definitions[\s>]/.test(text);
}

export function fromWsdl(text: string): ImportResult {
  if (/<!DOCTYPE/i.test(text)) throw new ImportError('A WSDL with a DOCTYPE is not read.');
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: (m: string) => errors.push(m), fatalError: (m: string) => errors.push(m) } }).parseFromString(text, 'text/xml');
  const root = doc?.documentElement as unknown as El | null;
  if (!root || root.localName !== 'definitions' || root.namespaceURI !== WSDL) {
    throw new ImportError(`Not a WSDL 1.1 document${errors[0] ? `: ${errors[0]}` : '.'}`);
  }
  const title = root.getAttribute('name') || 'SOAP service';
  const warnings: string[] = [];

  // The schema elements, by namespace and name, to write a request element out.
  const schemas = children(child(root, WSDL, 'types'), XSD, 'schema');
  const elements = new Map<string, El>();
  const types = new Map<string, El>();
  for (const schema of schemas) {
    const tns = schema.getAttribute('targetNamespace') ?? '';
    for (const el of children(schema, XSD, 'element')) elements.set(`${tns}|${el.getAttribute('name')}`, el);
    for (const t of children(schema, XSD, 'complexType')) types.set(`${tns}|${t.getAttribute('name')}`, t);
  }
  const fieldsOf = (complexType: El | null, depth: number): string => {
    if (!complexType || depth > 4) return '';
    const sequence = child(complexType, XSD, 'sequence') ?? child(complexType, XSD, 'all');
    return children(sequence, XSD, 'element')
      .map((f) => {
        const name = f.getAttribute('name') ?? localOf(f.getAttribute('ref'));
        const typeName = f.getAttribute('type');
        const nested = child(f, XSD, 'complexType') ?? (typeName ? types.get(`${namespaceOf(f, typeName)}|${localOf(typeName)}`) ?? null : null);
        const inner = nested ? fieldsOf(nested, depth + 1) : '';
        const pad = '  '.repeat(depth + 3);
        return inner ? `${pad}<ns:${name}>\n${inner}\n${pad}</ns:${name}>` : `${pad}<ns:${name}>?</ns:${name}>`;
      })
      .join('\n');
  };

  // The service's SOAP ports: 1.1 preferred, one binding per service.
  const bindings = new Map(children(root, WSDL, 'binding').map((b) => [b.getAttribute('name') ?? '', b]));
  const portTypes = new Map(children(root, WSDL, 'portType').map((p) => [p.getAttribute('name') ?? '', p]));
  const messages = new Map(children(root, WSDL, 'message').map((m) => [m.getAttribute('name') ?? '', m]));
  const ports = children(root, WSDL, 'service').flatMap((service) => children(service, WSDL, 'port'));
  const soapPorts = ports
    .map((port) => {
      const address = child(port, SOAP11, 'address') ?? child(port, SOAP12, 'address');
      const binding = bindings.get(localOf(port.getAttribute('binding')));
      const version = child(binding, SOAP11, 'binding') ? '1.1' : child(binding, SOAP12, 'binding') ? '1.2' : null;
      return address && binding && version ? { location: address.getAttribute('location') ?? '', binding, version } : null;
    })
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.version.localeCompare(b.version));
  if (soapPorts.length === 0) throw new ImportError('The WSDL has no SOAP binding with an address.');
  const port = soapPorts[0];
  if (soapPorts.some((p) => p.version !== port.version)) warnings.push(`The SOAP ${port.version} binding is used; the others are left out.`);

  let base: URL | null = null;
  try {
    base = new URL(port.location);
  } catch {
    warnings.push(`The service address "${port.location}" is not a URL.`);
  }
  const path = base ? `${base.pathname}${base.search}` : '';
  const variables: ImportVariable[] = [{ name: 'baseUrl', value: base ? base.origin : null, why: "The service's address, from the WSDL." }];

  const portType = portTypes.get(localOf(port.binding.getAttribute('type')));
  const soapNs = port.version === '1.1' ? SOAP11 : SOAP12;
  const envelopeNs = port.version === '1.1' ? 'http://schemas.xmlsoap.org/soap/envelope/' : 'http://www.w3.org/2003/05/soap-envelope';
  const tests: ImportedApiTest[] = [];
  for (const operation of children(port.binding, WSDL, 'operation')) {
    if (tests.length >= MAX_IMPORTED_TESTS) break;
    const name = operation.getAttribute('name') ?? 'operation';
    const action = child(operation, soapNs, 'operation')?.getAttribute('soapAction') ?? '';
    const abstract = children(portType, WSDL, 'operation').find((o) => o.getAttribute('name') === name);
    const inputMessage = messages.get(localOf(child(abstract, WSDL, 'input')?.getAttribute('message') ?? null));
    const part = children(inputMessage, WSDL, 'part')[0];
    const testWarnings: string[] = [];
    let bodyElement = `      <ns:${name}/>`;
    let tns = root.getAttribute('targetNamespace') ?? '';
    const elementName = part?.getAttribute('element');
    if (elementName) {
      tns = namespaceOf(part, elementName) ?? tns;
      const el = elements.get(`${tns}|${localOf(elementName)}`);
      const typeName = el?.getAttribute('type');
      const complex = el ? child(el, XSD, 'complexType') ?? (typeName ? types.get(`${namespaceOf(el, typeName)}|${localOf(typeName)}`) ?? null : null) : null;
      const fields = fieldsOf(complex, 0);
      bodyElement = fields ? `      <ns:${localOf(elementName)}>\n${fields}\n      </ns:${localOf(elementName)}>` : `      <ns:${localOf(elementName)}/>`;
      if (!el) testWarnings.push(`The element ${elementName} is not in the WSDL's schema: fill in the request.`);
    } else {
      testWarnings.push('An RPC-style operation: check the request element against the service.');
    }
    const envelope = [
      `<soap:Envelope xmlns:soap="${envelopeNs}" xmlns:ns="${tns}">`,
      '  <soap:Header/>',
      '  <soap:Body>',
      bodyElement,
      '  </soap:Body>',
      '</soap:Envelope>',
    ].join('\n');
    const contentType = port.version === '1.1' ? 'text/xml; charset=utf-8' : `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ''}`;
    tests.push({
      name: `${title} — ${name}`,
      method: 'POST',
      url: `{{baseUrl}}${path}`,
      queryParams: null,
      requestHeaders: { 'Content-Type': contentType, ...(port.version === '1.1' ? { SOAPAction: `"${action}"` } : {}) },
      requestBody: envelope,
      bodyType: 'raw',
      bodyRawContentType: port.version === '1.1' ? 'text/xml' : 'application/soap+xml',
      bodyGraphqlQuery: null,
      bodyGraphqlVariables: null,
      authType: null,
      authParams: null,
      assertions: [
        { id: randomUUID(), source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true },
        { id: randomUUID(), source: 'body_xpath', property: '//Fault', comparison: 'not_exists', enabled: true },
      ],
      module: title,
      source: `${port.version === '1.1' ? 'SOAP 1.1' : 'SOAP 1.2'} ${name}`,
      warnings: testWarnings,
    });
  }
  if (tests.length === 0) throw new ImportError('The SOAP binding has no operations.');
  return { format: 'wsdl', title, tests, variables, warnings };
}
