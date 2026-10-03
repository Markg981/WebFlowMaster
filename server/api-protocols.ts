import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

/**
 * The API tests that are not one HTTP request and one JSON answer (server/api-test-runner.ts).
 *
 * - **SOAP** is HTTP: a POST with an XML envelope and a SOAPAction header. What it needed was a way
 *   to read XML answers — `body_xpath` assertions and captures — and a WSDL import
 *   (server/api-import.ts).
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
  const prefixed = /[A-Za-z_][\w.-]*:[A-Za-z_]/.test(expression.replace(/::/g, '').replace(/['"][^'"]*['"]/g, ''));
  const source = prefixed
    ? xmlText
    : xmlText
        .replace(/\sxmlns(:[\w.-]+)?="[^"]*"/g, '')
        .replace(/\sxmlns(:[\w.-]+)?='[^']*'/g, '')
        .replace(/<(\/?)[\w.-]+:/g, '<$1')
        .replace(/\s[\w.-]+:([\w.-]+=)/g, ' $1');
  let doc: Document;
  try {
    doc = new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined, fatalError: () => undefined } }).parseFromString(source, 'text/xml') as unknown as Document;
  } catch {
    return undefined;
  }
  if (!doc?.documentElement) return undefined;
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
