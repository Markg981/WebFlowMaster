import { randomUUID } from 'node:crypto';
import type { ImportedApiTest, ImportOptions, ImportResult } from './api-import';
import { ImportError, MAX_IMPORTED_TESTS } from './api-import';
import {
  SoapDocumentBundle,
  WSDL,
  WSDL2,
  XSD,
  child,
  children,
  keyOf,
  qname,
  type Component,
  type El,
  type SchemaContext,
} from './soap-document-bundle';

const SOAP11 = 'http://schemas.xmlsoap.org/wsdl/soap/';
const SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';
const SOAP2 = 'http://www.w3.org/ns/wsdl/soap';
const xml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
const localOf = (value: string) => value.slice(value.lastIndexOf('|') + 1);
const required = <T>(value: T | undefined | null, description: string): T => {
  if (value == null) throw new ImportError(`Missing ${description}.`);
  return value;
};

export function looksLikeWsdl(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<([\w-]+:)?(definitions|description)[\s>]/.test(
    text,
  );
}

/** A bounded document/literal skeleton, preserving each element's schema namespace. */
function skeleton(
  bundle: SoapDocumentBundle,
  elementKey: string,
  warnings: string[],
): { body: string; declarations: string } {
  const target = required(bundle.elements.get(elementKey), `schema element ${elementKey}`);
  const prefixes = new Map<string, string>([[target.schema.namespace, 'ns']]);
  let count = 0;
  const nameFor = (name: string, ns: string) => {
    if (!/^[A-Za-z_][\w.-]*$/.test(name))
      throw new ImportError('Invalid XML element name in schema.');
    if (!ns) return name;
    if (!prefixes.has(ns)) prefixes.set(ns, `ns${prefixes.size + 1}`);
    return `${prefixes.get(ns)}:${name}`;
  };
  const schemaQName = (element: El, value: string, schema: SchemaContext): string => {
    const key = qname(element, value);
    // Chameleon includes adopt their including schema's namespace for absent-namespace references.
    return key.startsWith('|') && !schema.root.getAttribute('targetNamespace')
      ? keyOf(schema.namespace, localOf(key))
      : key;
  };
  const typeOf = (el: El, schema: SchemaContext): Component | null => {
    const inline = child(el, XSD, 'complexType') ?? child(el, XSD, 'simpleType');
    if (inline) return { element: inline, schema };
    const type = el.getAttribute('type');
    if (!type) return null;
    const key = schemaQName(el, type, schema);
    if (key.startsWith(`${XSD}|`)) return null;
    return required(bundle.types.get(key), `schema type ${key}`);
  };
  const fields = (complex: Component | null, depth: number, stack: Set<El>): string[] => {
    if (!complex) return [];
    const { element, schema } = complex;
    if (stack.has(element) || depth > 10)
      throw new ImportError(
        'Recursive or excessively deep schema cannot produce a finite request skeleton.',
      );
    if (element.localName === 'simpleType') return [];
    const next = new Set(stack).add(element);
    const extension = child(child(element, XSD, 'complexContent'), XSD, 'extension');
    if (child(child(element, XSD, 'complexContent'), XSD, 'restriction'))
      throw new ImportError('XSD complex-content restriction is unsupported.');
    const output: string[] = [];
    if (extension?.getAttribute('base')) {
      const base = schemaQName(extension, extension.getAttribute('base')!, schema);
      if (base !== keyOf(XSD, 'anyType'))
        output.push(
          ...fields(required(bundle.types.get(base), `extension base ${base}`), depth, next),
        );
    }
    const container = extension ?? element;
    if (child(element, XSD, 'simpleContent'))
      warnings.push('XSD simpleContent requires manual value/attribute completion.');
    if (
      children(container, XSD, 'attribute').length ||
      child(container, XSD, 'attributeGroup') ||
      child(container, XSD, 'anyAttribute')
    )
      warnings.push('XSD attributes require manual completion.');
    const compositor =
      child(container, XSD, 'sequence') ??
      child(container, XSD, 'all') ??
      child(container, XSD, 'choice');
    if (compositor?.localName === 'choice')
      warnings.push(
        'XSD choice: choose the appropriate alternative; the skeleton lists alternatives.',
      );
    if (
      child(container, XSD, 'group') ||
      child(compositor, XSD, 'group') ||
      child(compositor, XSD, 'any')
    )
      throw new ImportError('XSD groups/wildcards are unsupported for request skeletons.');
    if (children(compositor, XSD, 'sequence').length || children(compositor, XSD, 'choice').length)
      throw new ImportError('Nested XSD compositors are unsupported for request skeletons.');
    for (const el of children(compositor, XSD, 'element'))
      output.push(render({ element: el, schema }, depth + 1, false, next));
    return output;
  };
  const render = (component: Component, depth: number, global: boolean, stack: Set<El>): string => {
    if (++count > 5000) throw new ImportError('Schema expansion exceeds 5000 elements.');
    const { element, schema } = component;
    if (stack.has(element))
      throw new ImportError(
        'Recursive schema element reference cannot produce a finite request skeleton.',
      );
    const ref = element.getAttribute('ref');
    if (ref)
      return render(
        required(
          bundle.elements.get(schemaQName(element, ref, schema)),
          `referenced schema element ${ref}`,
        ),
        depth,
        true,
        new Set(stack).add(element),
      );
    if (element.getAttribute('substitutionGroup'))
      warnings.push('XSD substitution groups are not expanded.');
    const qualified =
      global ||
      element.getAttribute('form') === 'qualified' ||
      (!element.getAttribute('form') &&
        schema.root.getAttribute('elementFormDefault') === 'qualified');
    const tag = nameFor(element.getAttribute('name') || '', qualified ? schema.namespace : '');
    const pad = '  '.repeat(depth + 3);
    const complex = typeOf(element, schema);
    const inner = fields(complex, depth, stack);
    if (inner.length) return `${pad}<${tag}>\n${inner.join('\n')}\n${pad}</${tag}>`;
    return complex?.element.localName === 'complexType' &&
      !child(complex.element, XSD, 'simpleContent')
      ? `${pad}<${tag}/>`
      : `${pad}<${tag}>?</${tag}>`;
  };
  const body = render(target, 0, true, new Set());
  return {
    body,
    declarations: [...prefixes]
      .filter(([ns]) => !!ns)
      .map(([ns, prefix]) => `xmlns:${prefix}="${xml(ns)}"`)
      .join(' '),
  };
}

interface Endpoint {
  id: string;
  label: string;
  address: string;
  binding: El;
  version: '1.1' | '1.2';
}
interface Operation {
  name: string;
  action: string;
  element: string;
  oneWay: boolean;
  warnings: string[];
}

function endpoints(bundle: SoapDocumentBundle, ns: string): Endpoint[] {
  const bindings = bundle.components(ns, 'binding');
  for (const name of ns === WSDL ? ['message', 'portType', 'service'] : ['interface', 'service'])
    bundle.components(ns, name);
  const result: Endpoint[] = [];
  for (const root of bundle.definitions)
    for (const service of children(root, ns, 'service'))
      for (const port of children(service, ns, ns === WSDL ? 'port' : 'endpoint')) {
        const binding = required(
          bindings.get(qname(port, port.getAttribute('binding') || '')),
          'endpoint binding',
        );
        let version: Endpoint['version'] | null = null;
        let address = '';
        if (ns === WSDL) {
          const soap = child(binding, SOAP11, 'binding') ?? child(binding, SOAP12, 'binding');
          if (!soap) continue;
          const transport = soap.getAttribute('transport');
          if (transport && transport !== 'http://schemas.xmlsoap.org/soap/http') {
            bundle.warnings.push('A non-HTTP SOAP binding was left out.');
            continue;
          }
          version = soap.namespaceURI === SOAP11 ? '1.1' : '1.2';
          address =
            child(port, version === '1.1' ? SOAP11 : SOAP12, 'address')?.getAttribute('location') ||
            '';
        } else {
          if (binding.getAttribute('type') !== SOAP2) continue;
          const declared = binding.getAttributeNS(SOAP2, 'version') || '1.2';
          if (declared !== '1.1' && declared !== '1.2') {
            bundle.warnings.push(`Unsupported SOAP version ${declared}.`);
            continue;
          }
          const protocol = binding.getAttributeNS(SOAP2, 'protocol');
          const httpProtocol =
            declared === '1.1'
              ? 'http://www.w3.org/2006/01/soap11/bindings/HTTP/'
              : 'http://www.w3.org/2003/05/soap/bindings/HTTP/';
          if (protocol !== httpProtocol) {
            bundle.warnings.push('A non-HTTP WSDL 2 SOAP binding was left out.');
            continue;
          }
          version = declared;
          address = port.getAttribute('address') || '';
        }
        if (!address) continue;
        let cleanAddress: string;
        try {
          const url = new URL(address);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
          let credentialsRemoved = !!(url.username || url.password);
          url.username = '';
          url.password = '';
          url.hash = '';
          for (const key of [...url.searchParams.keys()])
            if (/token|secret|password|(?:api[_-]?)?key|authorization|credential/i.test(key)) {
              url.searchParams.delete(key);
              credentialsRemoved = true;
            }
          if (credentialsRemoved)
            bundle.warnings.push(
              'Endpoint credentials were removed; configure authentication using environment secrets.',
            );
          cleanAddress = url.href;
        } catch {
          throw new ImportError('The SOAP endpoint has an invalid HTTP address URL.');
        }
        result.push({
          id: `${root.getAttribute('targetNamespace')}|${service.getAttribute('name')}|${port.getAttribute('name')}`,
          label: `${service.getAttribute('name')} / ${port.getAttribute('name')} (SOAP ${version})`,
          address: cleanAddress,
          binding,
          version,
        });
      }
  return result.sort((a, b) => a.version.localeCompare(b.version));
}

function operations11(bundle: SoapDocumentBundle, port: Endpoint): Operation[] {
  const binding = port.binding;
  const soapNs = port.version === '1.1' ? SOAP11 : SOAP12;
  const style = child(binding, soapNs, 'binding')?.getAttribute('style') || 'document';
  const portTypes = bundle.components(WSDL, 'portType');
  const messages = bundle.components(WSDL, 'message');
  const abstract = required(
    portTypes.get(qname(binding, binding.getAttribute('type') || '')),
    'WSDL portType',
  );
  return children(binding, WSDL, 'operation').map((operation) => {
    const name = operation.getAttribute('name') || 'operation';
    const soap = child(operation, soapNs, 'operation');
    if ((soap?.getAttribute('style') || style) !== 'document')
      throw new ImportError('RPC SOAP bindings are unsupported; use document/literal.');
    const input = child(operation, WSDL, 'input');
    const body = child(input, soapNs, 'body');
    if (body?.getAttribute('use') === 'encoded')
      throw new ImportError('Encoded SOAP bodies are unsupported.');
    const candidates = children(abstract, WSDL, 'operation').filter(
      (o) => o.getAttribute('name') === name,
    );
    if (candidates.length !== 1) throw new ImportError(`Missing or ambiguous operation ${name}.`);
    const request = required(child(candidates[0], WSDL, 'input'), `input for ${name}`);
    const message = required(
      messages.get(qname(request, request.getAttribute('message') || '')),
      `message for ${name}`,
    );
    let parts = children(message, WSDL, 'part');
    if (body?.getAttribute('parts')) {
      const names = body.getAttribute('parts')!.trim().split(/\s+/);
      parts = names.map((part) =>
        required(
          parts.find((p) => p.getAttribute('name') === part),
          `message part ${part}`,
        ),
      );
    }
    if (parts.length !== 1 || !parts[0].getAttribute('element'))
      throw new ImportError('Only single-element document/literal messages are supported.');
    const warnings: string[] = [];
    if (child(input, soapNs, 'header')) warnings.push('SOAP headers must be completed manually.');
    return {
      name,
      action: soap?.getAttribute('soapAction') || '',
      element: qname(parts[0], parts[0].getAttribute('element')!),
      oneWay: !child(candidates[0], WSDL, 'output'),
      warnings,
    };
  });
}

function operations2(bundle: SoapDocumentBundle, port: Endpoint): Operation[] {
  const interfaces = bundle.components(WSDL2, 'interface');
  const iface = required(
    interfaces.get(qname(port.binding, port.binding.getAttribute('interface') || '')),
    'WSDL 2 interface',
  );
  if (iface.getAttribute('extends'))
    throw new ImportError('WSDL 2 interface inheritance is unsupported.');
  const result: Operation[] = [];
  for (const operation of children(port.binding, WSDL2, 'operation')) {
    const ref = qname(operation, operation.getAttribute('ref') || '');
    const interfaceNamespace = (iface.parentNode as El).getAttribute('targetNamespace') || '';
    const matches = children(iface, WSDL2, 'operation').filter(
      (o) => keyOf(interfaceNamespace, o.getAttribute('name') || '') === ref,
    );
    if (matches.length !== 1)
      throw new ImportError(`Missing or ambiguous WSDL 2 operation ${ref}.`);
    const abstract = matches[0];
    const pattern = abstract.getAttribute('pattern');
    if (pattern !== `${WSDL2}/in-out` && pattern !== `${WSDL2}/in-only`) {
      bundle.warnings.push(
        `Unsupported WSDL 2 message-exchange pattern ${pattern}; ${localOf(ref)} was left out.`,
      );
      continue;
    }
    const style = abstract.getAttribute('style') || '';
    if (style.includes('/rpc'))
      throw new ImportError('RPC WSDL 2 operation styles are unsupported.');
    const input = required(child(abstract, WSDL2, 'input'), `input for ${ref}`);
    const element = input.getAttribute('element') || '';
    if (element.startsWith('#')) throw new ImportError(`WSDL 2 element ${element} is unsupported.`);
    if (pattern.endsWith('/in-out') && !child(abstract, WSDL2, 'output'))
      throw new ImportError(`Missing output for ${ref}.`);
    result.push({
      name: localOf(ref),
      action: operation.getAttributeNS(SOAP2, 'action') || '',
      element: qname(input, element),
      oneWay: pattern.endsWith('/in-only'),
      warnings: [],
    });
  }
  return result;
}

export function fromWsdl(text: string, options: ImportOptions = {}): ImportResult {
  const bundle = new SoapDocumentBundle(text, options);
  const ns = bundle.root.namespaceURI!;
  const available = endpoints(bundle, ns);
  if (!available.length)
    throw new ImportError('The WSDL has no supported SOAP HTTP binding with an address.');
  const port = options.endpoint
    ? required(
        available.find((p) => p.id === options.endpoint),
        'selected SOAP endpoint',
      )
    : available[0];
  if (available.some((p) => p.version !== port.version))
    bundle.warnings.push(`The SOAP ${port.version} binding is used; the others are left out.`);
  for (const root of bundle.definitions) {
    if (['Policy', 'PolicyReference'].some((name) => root.getElementsByTagNameNS('*', name).length))
      bundle.warnings.push(
        'WSDL policy extensions are not carried over; configure authentication and SOAP headers manually.',
      );
    if (root.getElementsByTagNameNS(SOAP2, 'module').length)
      bundle.warnings.push(
        'WSDL 2 SOAP modules are not carried over; configure their security and headers manually.',
      );
  }
  const title =
    bundle.root.getAttribute('name') ||
    children(bundle.root, ns, 'service')[0]?.getAttribute('name') ||
    'SOAP service';
  const base = new URL(port.address);
  const ops = ns === WSDL ? operations11(bundle, port) : operations2(bundle, port);
  const tests: ImportedApiTest[] = ops.slice(0, MAX_IMPORTED_TESTS).map((operation) => {
    if (/[\r\n"]/.test(operation.action))
      throw new ImportError('Invalid SOAP action for HTTP headers.');
    const request = skeleton(bundle, operation.element, operation.warnings);
    const envelopeNs =
      port.version === '1.1'
        ? 'http://schemas.xmlsoap.org/soap/envelope/'
        : 'http://www.w3.org/2003/05/soap-envelope';
    const contentType =
      port.version === '1.1'
        ? 'text/xml; charset=utf-8'
        : `application/soap+xml; charset=utf-8${operation.action ? `; action="${operation.action}"` : ''}`;
    return {
      name: `${title} — ${operation.name}`,
      method: 'POST',
      url: `{{baseUrl}}${base.pathname}${base.search}`,
      queryParams: null,
      requestHeaders: {
        'Content-Type': contentType,
        ...(port.version === '1.1' ? { SOAPAction: `"${operation.action}"` } : {}),
      },
      requestBody: [
        `<soap:Envelope xmlns:soap="${envelopeNs}" ${request.declarations}>`,
        '  <soap:Header/>',
        '  <soap:Body>',
        request.body,
        '  </soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
      bodyType: 'raw',
      bodyRawContentType: port.version === '1.1' ? 'text/xml' : 'application/soap+xml',
      bodyGraphqlQuery: null,
      bodyGraphqlVariables: null,
      authType: null,
      authParams: null,
      assertions: operation.oneWay
        ? [
            {
              id: randomUUID(),
              source: 'status_code',
              comparison: 'greater_than_or_equals',
              targetValue: '200',
              enabled: true,
            },
            {
              id: randomUUID(),
              source: 'status_code',
              comparison: 'less_than',
              targetValue: '300',
              enabled: true,
            },
          ]
        : [
            {
              id: randomUUID(),
              source: 'status_code',
              comparison: 'equals',
              targetValue: '200',
              enabled: true,
            },
            {
              id: randomUUID(),
              source: 'body_xpath',
              property: '//Fault',
              comparison: 'not_exists',
              enabled: true,
            },
          ],
      module: title,
      source: `SOAP ${port.version} ${operation.name}`,
      warnings: [...new Set(operation.warnings)],
    };
  });
  if (!tests.length) throw new ImportError('The SOAP binding has no supported operations.');
  if (ops.length > MAX_IMPORTED_TESTS)
    bundle.warnings.push(`Only the first ${MAX_IMPORTED_TESTS} operations were imported.`);
  return {
    format: 'wsdl',
    title,
    tests,
    variables: [
      { name: 'baseUrl', value: base.origin, why: "The service's address, from the WSDL." },
    ],
    warnings: [...new Set(bundle.warnings)],
    endpoints: available.map(({ id, label, address }) => ({ id, label, address })),
    selectedEndpoint: port.id,
  };
}
