import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { runApiRequest } from './api-test-runner';
import { xpathValue, readWebSocketPlan } from './api-protocols';
import { importApiDescription } from './api-import';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn(), verbose: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/** SOAP, WebSocket and gRPC API tests (server/api-protocols.ts), against real servers on this machine. */

const assertion = (source: string, comparison: string, targetValue?: string, property?: string) =>
  ({ id: randomUUID(), source, comparison, targetValue, property, enabled: true }) as any;

const SOAP_RESPONSE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:GetOrderResponse xmlns:ns2="http://shop.example/orders">
      <ns2:order id="42"><ns2:status>Shipped</ns2:status><ns2:total>12.50</ns2:total></ns2:order>
    </ns2:GetOrderResponse>
  </soap:Body>
</soap:Envelope>`;

describe('XPath on XML answers', () => {
  it('finds elements without their namespaces, or with the document’s prefixes', () => {
    expect(xpathValue(SOAP_RESPONSE, '//status')).toBe('Shipped');
    expect(xpathValue(SOAP_RESPONSE, '//order/@id')).toBe('42');
    expect(xpathValue(SOAP_RESPONSE, 'count(//order)')).toBe('1');
    expect(xpathValue(SOAP_RESPONSE, '//ns2:total')).toBe('12.50');
    expect(xpathValue(SOAP_RESPONSE, '//Fault')).toBeUndefined();
    expect(xpathValue('{"json": true}', '//x')).toBeUndefined();
  });
});

describe('SOAP over HTTP', () => {
  let server: http.Server;
  let base = '';
  let seen: { action?: string; body?: string } = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = { action: String(req.headers.soapaction ?? ''), body };
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(SOAP_RESPONSE);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('sends the envelope and reads the answer with XPath, capturing a value', async () => {
    const result = await runApiRequest(
      {
        method: 'POST',
        url: `${base}/orders`,
        headers: { 'Content-Type': 'text/xml', SOAPAction: '"GetOrder"' },
        body: '<soap:Envelope><soap:Body><GetOrder><id>{{orderId}}</id></GetOrder></soap:Body></soap:Envelope>',
        assertions: [assertion('body_xpath', 'equals', 'Shipped', '//status'), assertion('body_xpath', 'not_exists', undefined, '//Fault'), assertion('body_xpath', 'greater_than', '10', '//total')],
        extractions: [{ id: randomUUID(), name: 'orderStatus', source: 'body_xpath', property: '//order/@id' }],
      },
      { orderId: '42' },
    );
    expect(result.assertions.map((a) => a.pass)).toEqual([true, true, true]);
    expect(result.extracted).toEqual({ orderStatus: '42' });
    expect(seen).toMatchObject({ action: '"GetOrder"', body: expect.stringContaining('<id>42</id>') });
  });
});

describe('WSDL import', () => {
  const wsdl = `<?xml version="1.0"?>
<wsdl:definitions name="Orders" targetNamespace="http://shop.example/orders" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
  xmlns:tns="http://shop.example/orders" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <wsdl:types>
    <xs:schema targetNamespace="http://shop.example/orders">
      <xs:element name="GetOrder"><xs:complexType><xs:sequence>
        <xs:element name="id" type="xs:int"/><xs:element name="customer" type="tns:Customer"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:complexType name="Customer"><xs:sequence><xs:element name="email" type="xs:string"/></xs:sequence></xs:complexType>
      <xs:element name="Ping"><xs:complexType><xs:sequence/></xs:complexType></xs:element>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="GetOrderIn"><wsdl:part name="p" element="tns:GetOrder"/></wsdl:message>
  <wsdl:message name="PingIn"><wsdl:part name="p" element="tns:Ping"/></wsdl:message>
  <wsdl:portType name="OrdersPort">
    <wsdl:operation name="GetOrder"><wsdl:input message="tns:GetOrderIn"/></wsdl:operation>
    <wsdl:operation name="Ping"><wsdl:input message="tns:PingIn"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="OrdersSoap" type="tns:OrdersPort">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="GetOrder"><soap:operation soapAction="http://shop.example/GetOrder"/></wsdl:operation>
    <wsdl:operation name="Ping"><soap:operation soapAction="http://shop.example/Ping"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="OrdersSoap12" type="tns:OrdersPort">
    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="GetOrder"><soap12:operation soapAction="http://shop.example/GetOrder"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="OrdersService">
    <wsdl:port name="p11" binding="tns:OrdersSoap"><soap:address location="https://shop.example/ws/orders"/></wsdl:port>
    <wsdl:port name="p12" binding="tns:OrdersSoap12"><soap12:address location="https://shop.example/ws/orders12"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

  it('writes one SOAP 1.1 test per operation, with the request element from the schema', () => {
    const result = importApiDescription(wsdl);
    expect(result).toMatchObject({ format: 'wsdl', title: 'Orders', variables: [{ name: 'baseUrl', value: 'https://shop.example' }] });
    expect(result.warnings[0]).toContain('SOAP 1.1');
    expect(result.tests.map((t) => t.name)).toEqual(['Orders — GetOrder', 'Orders — Ping']);
    const [getOrder] = result.tests;
    expect(getOrder).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/ws/orders',
      requestHeaders: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://shop.example/GetOrder"' },
    });
    expect(getOrder.requestBody).toContain('xmlns:ns="http://shop.example/orders"');
    expect(getOrder.requestBody).toMatch(/<ns:GetOrder>\s*<ns:id>\?<\/ns:id>\s*<ns:customer>\s*<ns:email>\?<\/ns:email>\s*<\/ns:customer>\s*<\/ns:GetOrder>/);
    expect(getOrder.assertions.map((a) => `${a.source} ${a.comparison}`)).toEqual(['status_code equals', 'body_xpath not_exists']);
    expect(() => importApiDescription('<html><body/></html>')).toThrow(/not a WSDL/);
  });
});

describe('WebSocket', () => {
  let wss: WebSocketServer;
  let url = '';
  let lastHeaders: http.IncomingHttpHeaders = {};

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.once('listening', r));
    url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/feed`;
    wss.on('connection', (socket, req) => {
      lastHeaders = req.headers;
      socket.send(JSON.stringify({ type: 'welcome' }));
      socket.on('message', (data) => socket.send(JSON.stringify({ type: 'echo', text: data.toString() })));
    });
  });
  afterAll(() => new Promise((r) => wss.close(r)));

  it('reads lines or a plan', () => {
    expect(readWebSocketPlan('a\n\nb')).toEqual({ send: ['a', 'b'], waitMs: 2000 });
    expect(readWebSocketPlan('{"send": ["x", {"op": 1}], "waitMs": 50, "until": 2}')).toEqual({ send: ['x', '{"op":1}'], waitMs: 50, until: 2 });
    expect(readWebSocketPlan('{"op": "subscribe"}')).toEqual({ send: ['{"op": "subscribe"}'], waitMs: 2000 });
  });

  it('sends messages, collects the answers, and asserts on them', async () => {
    const result = await runApiRequest(
      {
        method: 'WEBSOCKET',
        url,
        headers: { Authorization: 'Bearer {{token}}' },
        body: JSON.stringify({ send: ['hello {{who}}'], waitMs: 3000, until: 2 }),
        assertions: [assertion('body_json_path', 'equals', '2', 'count'), assertion('body_json_path', 'equals', 'hello world', 'last.text'), assertion('body_json_path', 'equals', 'welcome', 'messages[0].type')],
      },
      { token: 't-1', who: 'world' },
    );
    expect(result.error).toBeUndefined();
    expect(result.assertions.map((a) => a.pass)).toEqual([true, true, true]);
    expect(result.durationMs).toBeLessThan(2500); // stopped at `until`, not at waitMs
    expect(lastHeaders.authorization).toBe('Bearer t-1');
  });

  it('says why it could not connect, and refuses to go through an agent', async () => {
    const refused = await runApiRequest({ method: 'WEBSOCKET', url: 'ws://127.0.0.1:1/x', assertions: [] }, {});
    expect(refused.error).toMatch(/WebSocket error|Could not connect/);
    const viaAgent = Object.assign(async () => new Response(''), {}) as any;
    expect((await runApiRequest({ method: 'WEBSOCKET', url, assertions: [] }, {}, viaAgent)).error).toContain('not through a local agent');
  });
});

describe('gRPC', () => {
  const proto = `syntax = "proto3";
package shop;
service Orders { rpc Get (GetRequest) returns (Order); }
message GetRequest { int32 id = 1; }
message Order { int32 id = 1; string status = 2; repeated string items = 3; }`;
  let server: import('@grpc/grpc-js').Server;
  let address = '';
  let seenMetadata: Record<string, unknown> = {};

  beforeAll(async () => {
    const grpc = await import('@grpc/grpc-js');
    const loader = await import('@grpc/proto-loader');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grpc-test-'));
    await fs.writeFile(path.join(dir, 's.proto'), proto);
    const pkg = grpc.loadPackageDefinition(loader.loadSync(path.join(dir, 's.proto'))) as any;
    server = new grpc.Server();
    server.addService(pkg.shop.Orders.service, {
      Get: (call: any, callback: any) => {
        seenMetadata = call.metadata.getMap();
        if (call.request.id === 404) return callback({ code: grpc.status.NOT_FOUND, details: 'No such order' });
        callback(null, { id: call.request.id, status: 'Shipped', items: ['book', 'pen'] });
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))),
    );
    address = `127.0.0.1:${port}`;
  });
  afterAll(() => server?.forceShutdown());

  it('makes a unary call from the .proto, with headers as metadata', async () => {
    const result = await runApiRequest(
      {
        method: 'GRPC',
        url: `grpc://${address}/shop.Orders/Get`,
        headers: { 'x-tenant': '{{tenant}}' },
        body: '{"id": {{orderId}}}',
        protoDefinition: proto,
        assertions: [assertion('status_code', 'equals', '0'), assertion('body_json_path', 'equals', 'Shipped', 'status'), assertion('body_json_path', 'equals', 'pen', 'items[1]')],
      },
      { orderId: '7', tenant: 'acme' },
    );
    expect(result.error).toBeUndefined();
    expect(result.assertions.map((a) => a.pass)).toEqual([true, true, true]);
    expect(seenMetadata['x-tenant']).toBe('acme');
  });

  it('reports an error status as a response, and a wrong address or .proto clearly', async () => {
    const notFound = await runApiRequest({ method: 'GRPC', url: `grpc://${address}/shop.Orders/Get`, body: '{"id": 404}', protoDefinition: proto, assertions: [assertion('status_code', 'equals', '5')] }, {});
    expect(notFound).toMatchObject({ passed: true, status: 5, statusText: 'NOT_FOUND: No such order' });
    expect((await runApiRequest({ method: 'GRPC', url: `grpc://${address}/shop.Nope/Get`, protoDefinition: proto, assertions: [] }, {})).error).toContain('No service shop.Nope');
    expect((await runApiRequest({ method: 'GRPC', url: `grpc://${address}/shop.Orders`, protoDefinition: proto, assertions: [] }, {})).error).toContain('Name the method');
    expect((await runApiRequest({ method: 'GRPC', url: `grpc://${address}/shop.Orders/Get`, protoDefinition: '', assertions: [] }, {})).error).toContain('needs the .proto');
    expect((await runApiRequest({ method: 'GRPC', url: `grpc://${address}/shop.Orders/Get`, protoDefinition: 'not a proto', assertions: [] }, {})).error).toContain('.proto could not be read');
  });
});
