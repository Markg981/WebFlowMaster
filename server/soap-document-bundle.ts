import { DOMParser } from '@xmldom/xmldom';
import { ImportError, type ImportOptions } from './api-import';

export const WSDL = 'http://schemas.xmlsoap.org/wsdl/';
export const WSDL2 = 'http://www.w3.org/ns/wsdl';
export const XSD = 'http://www.w3.org/2001/XMLSchema';
export type El = Element;
export const children = (el: El | null | undefined, ns: string, name: string): El[] =>
  el
    ? Array.from(el.childNodes as unknown as ArrayLike<Node>).filter(
        (n): n is El =>
          n.nodeType === 1 && (n as El).namespaceURI === ns && (n as El).localName === name,
      )
    : [];
export const child = (el: El | null | undefined, ns: string, name: string): El | null =>
  children(el, ns, name)[0] ?? null;
export const keyOf = (ns: string, name: string) => `${ns}|${name}`;
export function qname(el: El, value: string): string {
  if (!/^(?:[\w.-]+:)?[\w.-]+$/.test(value)) throw new ImportError(`Invalid QName ${value}.`);
  const parts = value.split(':');
  const prefix = parts.length === 2 ? parts[0] : '';
  let node: El | null = el;
  while (node?.nodeType === 1) {
    if (node.hasAttribute(prefix ? `xmlns:${prefix}` : 'xmlns'))
      return keyOf(node.getAttribute(prefix ? `xmlns:${prefix}` : 'xmlns') || '', parts.at(-1)!);
    node = node.parentNode as El | null;
  }
  if (prefix) throw new ImportError(`Unbound QName prefix ${prefix}.`);
  return keyOf('', value);
}

// Logical names never reach filesystem/network APIs. Reject traversal outside the uploaded root.
export function logicalLocation(value: string, from?: string): string {
  // eslint-disable-next-line no-control-regex -- Logical names must not contain control bytes.
  if (!value || value.length > 2048 || /[\\\x00-\x1f]/.test(value) || /^[a-z]:[\\/]/i.test(value))
    throw new ImportError('Invalid document location/path.');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || (from && /^[a-z][a-z\d+.-]*:/i.test(from))) {
    try {
      const uri = /^[a-z][a-z\d+.-]*:/i.test(value) ? new URL(value) : new URL(value, from);
      if (uri.username || uri.password || uri.hash || uri.protocol === 'file:') throw new Error();
      return uri.href;
    } catch {
      throw new ImportError('Invalid document URI location.');
    }
  }
  if (value.startsWith('/') || value.includes('#') || value.includes('?'))
    throw new ImportError('Invalid logical document path.');
  const path = [...(from ? from.split('/').slice(0, -1) : []), ...value.split('/')];
  const result: string[] = [];
  for (const segment of path) {
    if (segment === '.' || segment === '') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new ImportError('Invalid document path encoding.');
    }
    if (decoded === '..') {
      if (!result.length) throw new ImportError('Document path escapes the bundle root.');
      result.pop();
    } else {
      // eslint-disable-next-line no-control-regex -- Decode before checking separators and control bytes.
      if (/[\\/\x00-\x1f]/.test(decoded)) throw new ImportError('Invalid document path.');
      result.push(decoded);
    }
  }
  if (!result.length) throw new ImportError('Empty document location.');
  return result.join('/');
}

interface Resource {
  location: string;
  root: El;
}
export interface SchemaContext {
  root: El;
  namespace: string;
}
export interface Component {
  element: El;
  schema: SchemaContext;
}
export class SoapDocumentBundle {
  readonly warnings: string[] = [];
  readonly definitions: El[] = [];
  readonly elements = new Map<string, Component>();
  readonly types = new Map<string, Component>();
  readonly groups = new Map<string, Component>();
  readonly root: El;
  private resources = new Map<string, Resource>();
  private visited = new Set<string>();
  private active = new Set<string>();
  private schemaVisited = new Set<string>();
  private schemaActive = new Set<string>();
  private schemaIds = new Map<El, number>();

  constructor(text: string, options: ImportOptions) {
    const documents = [
      { location: options.rootLocation ?? 'service.wsdl', content: text },
      ...(options.documents ?? []),
    ];
    if (documents.length > 32)
      throw new ImportError('A SOAP bundle may contain at most 32 documents.');
    if (documents.reduce((n, d) => n + Buffer.byteLength(d.content, 'utf8'), 0) > 10 * 1024 * 1024)
      throw new ImportError('The SOAP bundle exceeds 10 MiB.');
    for (const document of documents) {
      const location = logicalLocation(document.location);
      if (this.resources.has(location))
        throw new ImportError(`Duplicate document location ${location}.`);
      if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(document.content))
        throw new ImportError('DOCTYPE/entity declarations are not read in SOAP bundles.');
      const errors: string[] = [];
      const doc = new DOMParser({
        errorHandler: {
          warning: (m) => errors.push(m),
          error: (m) => errors.push(m),
          fatalError: (m) => errors.push(m),
        },
      }).parseFromString(document.content, 'text/xml');
      const root = doc?.documentElement as unknown as El;
      if (errors.length || !root) throw new ImportError(`Malformed XML in ${location}.`);
      if (!(
        (root.namespaceURI === WSDL && root.localName === 'definitions') ||
        (root.namespaceURI === WSDL2 && root.localName === 'description') ||
        (root.namespaceURI === XSD && root.localName === 'schema')
      ))
        throw new ImportError(`Unsupported SOAP document ${location}.`);
      this.resources.set(location, { location, root });
    }
    const rootResource = this.resources.get(logicalLocation(documents[0].location))!;
    this.root = rootResource.root;
    if (this.root.namespaceURI === XSD) throw new ImportError('The root must be a WSDL document.');
    this.visitWsdl(rootResource, 0);
  }

  private resolve(
    from: Resource,
    reference: string,
    expectedNamespace: string,
    ns: string,
    kind: string,
  ): Resource {
    let resource: Resource | undefined;
    if (reference) resource = this.resources.get(logicalLocation(reference, from.location));
    else {
      const candidates = [...this.resources.values()]
        .flatMap((r) => {
          if (r.root.namespaceURI === ns) return [r];
          if (ns === XSD)
            return children(child(r.root, r.root.namespaceURI!, 'types'), XSD, 'schema').map(
              (root) => ({ root, location: r.location }),
            );
          return [];
        })
        .filter((r) => (r.root.getAttribute('targetNamespace') || '') === expectedNamespace);
      if (candidates.length !== 1)
        throw new ImportError(`Missing or ambiguous ${kind} for namespace ${expectedNamespace}.`);
      resource = candidates[0];
    }
    if (!resource)
      throw new ImportError(
        `Missing imported document ${reference}. Supply it in the SOAP bundle.`,
      );
    if (resource.root.namespaceURI !== ns)
      throw new ImportError(`Unexpected document kind for ${reference}.`);
    const actual = resource.root.getAttribute('targetNamespace') || '';
    if (actual !== expectedNamespace && !(kind === 'include' && ns === XSD && actual === ''))
      throw new ImportError(`Imported namespace mismatch in ${resource.location}.`);
    return resource;
  }

  private visitWsdl(resource: Resource, depth: number): void {
    if (depth > 10) throw new ImportError('SOAP import depth exceeds 10.');
    if (this.active.has(resource.location)) {
      this.warnings.push(`Import cycle at ${resource.location}; resolved once.`);
      return;
    }
    if (this.visited.has(resource.location)) return;
    this.active.add(resource.location);
    this.definitions.push(resource.root);
    const ns = resource.root.namespaceURI!;
    for (const schema of children(child(resource.root, ns, 'types'), XSD, 'schema'))
      this.visitSchema(schema, resource, depth, schema.getAttribute('targetNamespace') || '');
    for (const kind of ['import', 'include'])
      for (const link of children(resource.root, ns, kind)) {
        const expected =
          kind === 'include'
            ? resource.root.getAttribute('targetNamespace') || ''
            : link.getAttribute('namespace') || '';
        this.visitWsdl(
          this.resolve(resource, link.getAttribute('location') || '', expected, ns, kind),
          depth + 1,
        );
      }
    this.active.delete(resource.location);
    this.visited.add(resource.location);
  }

  private visitSchema(root: El, resource: Resource, depth: number, namespace: string): void {
    if (depth > 10) throw new ImportError('SOAP schema import depth exceeds 10.');
    if (!this.schemaIds.has(root)) this.schemaIds.set(root, this.schemaIds.size);
    const id = `${this.schemaIds.get(root)}|${namespace}`;
    if (this.schemaActive.has(id)) {
      this.warnings.push(`Schema import cycle at ${resource.location}; resolved once.`);
      return;
    }
    if (this.schemaVisited.has(id)) return;
    this.schemaActive.add(id);
    const schema: SchemaContext = { root, namespace };
    for (const [name, index] of [
      ['element', this.elements],
      ['complexType', this.types],
      ['simpleType', this.types],
      ['group', this.groups],
    ] as const) {
      for (const element of children(root, XSD, name)) {
        const key = keyOf(namespace, element.getAttribute('name') || '');
        if (index.has(key)) throw new ImportError(`Conflicting duplicate schema component ${key}.`);
        index.set(key, { element, schema });
      }
    }
    for (const kind of ['include', 'import'])
      for (const link of children(root, XSD, kind)) {
        const expected = kind === 'include' ? namespace : link.getAttribute('namespace') || '';
        const target = this.resolve(
          resource,
          link.getAttribute('schemaLocation') || '',
          expected,
          XSD,
          kind,
        );
        this.visitSchema(target.root, target, depth + 1, expected);
      }
    this.schemaActive.delete(id);
    this.schemaVisited.add(id);
  }

  components(ns: string, name: string): Map<string, El> {
    const index = new Map<string, El>();
    for (const root of this.definitions)
      for (const el of children(root, ns, name)) {
        const key = keyOf(
          root.getAttribute('targetNamespace') || '',
          el.getAttribute('name') || '',
        );
        if (index.has(key)) throw new ImportError(`Conflicting duplicate WSDL ${name} ${key}.`);
        index.set(key, el);
      }
    return index;
  }
}
