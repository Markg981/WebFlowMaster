import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

/**
 * The API tests that are not one HTTP request and one JSON answer (server/api-tests/api-test-runner.ts).
 *
 * - **SOAP** is HTTP: a POST with an XML envelope and a SOAPAction header. What it needed was a way
 *   to read XML answers — `body_xpath` assertions and captures — and a WSDL import
 *   (server/api-tests/api-import.ts).
 * - **WebSocket**: connect to a ws:// or wss:// address, send messages, collect what comes back for
 *   a while, and assert on it.
 * - **gRPC**: a unary call described by the .proto the test carries, to grpc:// or grpcs://
 *   host:port/package.Service/Method.
 *
 * Each returns the same shape a request does — a status, headers, a body and its text — so the
 * same assertions and captures apply.
 */

export type { ProtocolResponse } from '@shared/agent-protocol';
export { runGrpc, runWebSocket, readWebSocketPlan, parseGrpcTarget } from './api-network-protocols';

export const XPATH_MAX_EXPRESSION_CHARS = 500;
export const XPATH_MAX_DOCUMENT_CHARS = 2_000_000;
export const XPATH_MAX_NODES = 20_000;
/** Work units (nodes ^ nesting of the expression) an evaluation may cost; about a second at the limit. */
export const XPATH_MAX_WORK = 1e7;

/**
 * The xpath library is synchronous and cannot be interrupted, and an expression that nests
 * descendant searches or predicates costs nodes^depth. Refuse, before evaluating, a pair whose
 * estimated cost would stall the event loop (audit C-07).
 */
function assertXpathBudget(doc: Node, expression: string): void {
  let nodes = 0;
  const stack: Node[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    nodes += 1;
    if (nodes > XPATH_MAX_NODES) {
      throw new Error(`XML document has too many nodes for XPath (limit ${XPATH_MAX_NODES})`);
    }
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
  }
  const bare = expression.replace(/'[^']*'|"[^"]*"/g, '');
  const depth = (bare.match(/\/\/|\[|(?:descendant|following|preceding|ancestor)[\w-]*::/g) ?? [])
    .length;
  if (depth > 1 && nodes ** depth > XPATH_MAX_WORK) {
    throw new Error(
      `XPath expression too expensive for a document of ${nodes} nodes: simplify it (fewer nested // or predicates)`,
    );
  }
}

/**
 * The value an XPath expression selects in an XML document: the text of the first node, or the
 * number, string or boolean an expression such as count(…) evaluates to.
 *
 * An expression without a prefix (`//OrderId`) is read with the namespaces taken away, so it finds
 * `<ns2:OrderId>` inside a SOAP envelope without declaring them; one with a prefix is read as it is,
 * with the document's own prefixes.
 */
export function xpathValue(xmlText: string, expression: string): string | undefined {
  if (!xmlText.trim().startsWith('<')) return undefined;
  if (expression.length > XPATH_MAX_EXPRESSION_CHARS) {
    throw new Error(`XPath expression too long (limit ${XPATH_MAX_EXPRESSION_CHARS} characters)`);
  }
  if (xmlText.length > XPATH_MAX_DOCUMENT_CHARS) {
    throw new Error(
      `XML document too large for XPath (limit ${XPATH_MAX_DOCUMENT_CHARS} characters)`,
    );
  }
  const prefixed = /[A-Za-z_][\w.-]*:[A-Za-z_]/.test(
    expression.replace(/::/g, '').replace(/['"][^'"]*['"]/g, ''),
  );
  const source = prefixed
    ? xmlText
    : xmlText
        .replace(/\sxmlns(:[\w.-]+)?="[^"]*"/g, '')
        .replace(/\sxmlns(:[\w.-]+)?='[^']*'/g, '')
        .replace(/<(\/?)[\w.-]+:/g, '<$1')
        .replace(/\s[\w.-]+:([\w.-]+=)/g, ' $1');
  let doc: Document;
  try {
    doc = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: () => undefined,
        fatalError: () => undefined,
      },
    }).parseFromString(source, 'text/xml') as unknown as Document;
  } catch {
    return undefined;
  }
  if (!doc?.documentElement) return undefined;
  assertXpathBudget(doc as unknown as Node, expression);
  const namespaces: Record<string, string> = {};
  if (prefixed) {
    for (const m of xmlText.matchAll(/xmlns:([\w.-]+)="([^"]+)"/g)) namespaces[m[1]] = m[2];
  }
  let result: unknown;
  try {
    result = xpath.useNamespaces(namespaces)(expression, doc as unknown as Node);
  } catch (error) {
    throw new Error(`Not an XPath expression: ${expression} (${(error as Error).message})`);
  }
  if (Array.isArray(result)) {
    if (result.length === 0) return undefined;
    const node = result[0] as Node;
    return node.nodeType === 2 ? (node as Attr).value : (node.textContent ?? '');
  }
  return result === undefined || result === null ? undefined : String(result);
}
