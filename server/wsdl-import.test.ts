import { describe, expect, it } from 'vitest';
import { importApiDescription } from './api-import';
import { baseXsd, bundle, distributedWsdl, requestXsd, wsdl2 } from './tests/soap-bundle-fixtures';

describe('offline SOAP document bundles', () => {
 it('resolves nested relative schemas, inherited types and element refs', () => {
  const result = importApiDescription(distributedWsdl, {rootLocation:'service.wsdl',documents:bundle});
  expect(result.tests[0].requestBody).toContain('OrderId');
  expect(result.tests[0].requestBody).toContain('Note');
  expect(result.tests[0].warnings).toEqual([]);
  expect(result.variables[0].value).toBe('https://orders.example');
  expect(JSON.stringify(result)).not.toContain('password');
 });
 it('exposes selectable endpoints', () => {
  const preview = importApiDescription(distributedWsdl, {documents:bundle});
  expect(preview.endpoints).toHaveLength(2);
  const result = importApiDescription(distributedWsdl, {documents:bundle,endpoint:preview.endpoints![1].id});
  expect(result.selectedEndpoint).toBe(preview.endpoints![1].id);
  expect(result.variables[0].value).toBe('https://backup.example');
 });
 it('imports WSDL 2 SOAP 1.2 actions and one-way expectations', () => {
  const result = importApiDescription(wsdl2, {documents:bundle});
  expect(result.tests).toHaveLength(2);
  expect(result.tests[0].requestBody).toContain('http://www.w3.org/2003/05/soap-envelope');
  expect(result.tests[0].requestHeaders!['Content-Type']).toContain('action="urn:create"');
  expect(result.tests[1].assertions.some(a => a.comparison === 'equals' && a.targetValue === '200')).toBe(false);
  expect(result.tests[1].assertions).toContainEqual(expect.objectContaining({source:'status_code',comparison:'less_than',targetValue:'300'}));
 });
 it('refuses missing imports instead of generating an empty request', () => {
  expect(() => importApiDescription(distributedWsdl)).toThrow(/Missing.*request.xsd/i);
 });
 it('rejects declarations in every uploaded resource', () => {
  expect(() => importApiDescription(distributedWsdl,{documents:[...bundle,{location:'unused.xsd',content:'<!DOCTYPE schema><schema/>'}]})).toThrow(/DOCTYPE|entity/i);
 });
 it('refuses conflicting components and incorrect imported namespaces', () => {
  expect(() => importApiDescription(distributedWsdl,{documents:[{location:'types/request.xsd',content:requestXsd.replace('targetNamespace="urn:request"','targetNamespace="urn:wrong"')},bundle[1]]})).toThrow(/namespace/i);
  expect(() => importApiDescription(distributedWsdl,{documents:[bundle[0],{location:'types/base.xsd',content:baseXsd.replace('</x:schema>','<x:complexType name="OrderType"/></x:schema>')}]})).toThrow(/Conflicting|duplicate/i);
 });
 it('rejects duplicate logical locations, unsafe paths and bounds', () => {
  expect(() => importApiDescription(distributedWsdl,{documents:[...bundle,bundle[0]]})).toThrow(/duplicate/i);
  expect(() => importApiDescription(distributedWsdl,{documents:[{location:'../../request.xsd',content:requestXsd}]})).toThrow(/location|path/i);
  expect(() => importApiDescription(distributedWsdl,{documents:Array.from({length:32},(_,i)=>({location:`${i}.xsd`,content:baseXsd}))})).toThrow(/32/);
 });
 it('rejects encoded SOAP semantics explicitly', () => {
  expect(() => importApiDescription(distributedWsdl.replace('use="literal"','use="encoded"'),{documents:bundle})).toThrow(/encoded/i);
 });
 it('resolves external WSDL declarations and schemas by namespace, not local name', () => {
  const root = `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:s="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:t="urn:service" targetNamespace="urn:root"><import namespace="urn:service" location="https://spec.example/service.wsdl"/><service name="Local"><port name="Port" binding="t:Binding"><s:address location="https://local.example/soap"/></port></service></definitions>`;
  const result = importApiDescription(root,{documents:[{location:'https://spec.example/service.wsdl',content:distributedWsdl},...bundle.map(d=>({...d,location:`https://spec.example/${d.location}`}))]});
  expect(result.tests[0].requestBody).toContain('OrderId');
 });
 it('bounds XML bytes and import depth and rejects malformed uploaded XML', () => {
  expect(() => importApiDescription(distributedWsdl,{documents:[{location:'unused.xsd',content:'<x:schema>'}]})).toThrow(/Malformed/);
  expect(() => importApiDescription(distributedWsdl,{documents:[{location:'unused.xsd',content:' '.repeat(10*1024*1024)}]})).toThrow(/10 MiB/);
  const chain = Array.from({length:12},(_,i)=>({location:`types/${i}.xsd`,content:`<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:request">${i===11 ? '' : `<x:include schemaLocation="${i+1}.xsd"/>`}</x:schema>`}));
  expect(() => importApiDescription(distributedWsdl.replace('types/request.xsd','types/0.xsd'),{documents:chain})).toThrow(/depth.*10/i);
 });
 it('detects cyclic includes without re-expanding the same schema', () => {
  const cyclic = bundle.map(d=> d.location==='types/base.xsd' ? {...d,content:d.content.replace('</x:schema>','<x:include schemaLocation="request.xsd"/></x:schema>')} : d);
  const result = importApiDescription(distributedWsdl,{documents:cyclic});
  expect(result.tests[0].requestBody).toContain('OrderId');
  expect(result.warnings.join(' ')).toMatch(/cycle/);
 });
 it('keeps same local element names in distinct namespaces separate', () => {
  const xsd = requestXsd.replace('<x:include schemaLocation="base.xsd"/>','<x:include schemaLocation="base.xsd"/><x:import namespace="urn:other" schemaLocation="other.xsd"/>');
  const other = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:other"><x:element name="Order" type="x:string"/></x:schema>`;
  const result = importApiDescription(distributedWsdl,{documents:[{location:'types/request.xsd',content:xsd},bundle[1],{location:'types/other.xsd',content:other}]});
  expect(result.tests[0].requestBody).toContain('OrderId');
 });
 it('preserves explicitly qualified local fields and unqualified defaults', () => {
  const qualified = importApiDescription(distributedWsdl,{documents:bundle});
  expect(qualified.tests[0].requestBody).toContain('<ns:OrderId>?</ns:OrderId>');
  const unqualified = importApiDescription(distributedWsdl,{documents:bundle.map(d=>({...d,content:d.content.replace('elementFormDefault="qualified"','')}))});
  expect(unqualified.tests[0].requestBody).toContain('<OrderId>?</OrderId>');
  expect(unqualified.tests[0].requestBody).toContain('<ns:Order>');
 });
 it('removes endpoint query credentials from preview and generated requests', () => {
  const result = importApiDescription(distributedWsdl.replace('/soap"','/soap?token=private-token&amp;version=1"'),{documents:bundle});
  expect(JSON.stringify(result)).not.toContain('private-token');
  expect(result.tests[0].url).toContain('version=1');
 });
 it('resolves cross-namespace refs with distinct namespace declarations', () => {
  const xsd = requestXsd.replace('xmlns:r="urn:request"','xmlns:r="urn:request" xmlns:o="urn:other"').replace('<x:include schemaLocation="base.xsd"/>','<x:include schemaLocation="base.xsd"/><x:import namespace="urn:other" schemaLocation="other.xsd"/>').replace('ref="r:Details"','ref="o:Details"');
  const other = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:other"><x:element name="Details" type="x:string"/></x:schema>`;
  const result = importApiDescription(distributedWsdl,{documents:[{location:'types/request.xsd',content:xsd},bundle[1],{location:'types/other.xsd',content:other}]});
  expect(result.tests[0].requestBody).toContain('xmlns:ns2="urn:other"');
  expect(result.tests[0].requestBody).toContain('<ns2:Details>?</ns2:Details>');
 });
 it('resolves namespace-only imports against embedded schemas', () => {
  const inline = distributedWsdl.replace('<x:import namespace="urn:request" schemaLocation="types/request.xsd"/>','<x:import namespace="urn:request"/>').replace('</types>',`${requestXsd.replace('<x:include schemaLocation="base.xsd"/>','')}${baseXsd}</types>`);
  // Two embedded schemas can share a namespace when imported together via a location.
  // The import above is intentionally ambiguous: refuse to select one silently.
  expect(() => importApiDescription(inline)).toThrow(/ambiguous/i);
  const merged = requestXsd.replace('<x:include schemaLocation="base.xsd"/>',baseXsd.match(/<x:complexType[\s\S]*<\/x:complexType>/)![0]);
  const root = distributedWsdl.replace('<x:import namespace="urn:request" schemaLocation="types/request.xsd"/>','<x:import namespace="urn:request"/>').replace('</types>',`${merged}</types>`);
  expect(importApiDescription(root).tests[0].requestBody).toContain('OrderId');
 });
 it('adopts the including namespace for chameleon schema type references', () => {
  const chameleon = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified"><x:complexType name="Base"><x:sequence><x:element name="OrderId" type="Identifier"/></x:sequence></x:complexType><x:simpleType name="Identifier"><x:restriction base="x:string"/></x:simpleType></x:schema>`;
  expect(importApiDescription(distributedWsdl,{documents:[bundle[0],{location:'types/base.xsd',content:chameleon}]}).tests[0].requestBody).toContain('OrderId');
 });
 it('resolves WSDL 2 includes and SOAP 1.1 bindings', () => {
  const root = `<description xmlns="http://www.w3.org/ns/wsdl" xmlns:t="urn:v2" targetNamespace="urn:v2"><include location="description.wsdl"/><service name="Wrapper" interface="t:Orders"><endpoint name="Local" binding="t:Soap" address="https://local.example/v2"/></service></description>`;
  const soap11 = wsdl2.replace('s:protocol=', 's:version="1.1" s:protocol=').replace('http://www.w3.org/2003/05/soap/bindings/HTTP/', 'http://www.w3.org/2006/01/soap11/bindings/HTTP/');
  const result = importApiDescription(root,{documents:[{location:'description.wsdl',content:soap11},...bundle]});
  expect(result.tests[0].requestBody).toContain('http://schemas.xmlsoap.org/soap/envelope/');
  expect(result.tests[0].requestHeaders).toMatchObject({SOAPAction:'"urn:create"'});
 });
 it('refuses recursive element references with a bounded import error', () => {
  const recursive = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" xmlns:r="urn:request" targetNamespace="urn:request"><x:element name="Order" ref="r:Order"/></x:schema>`;
  expect(() => importApiDescription(distributedWsdl,{documents:[{location:'types/request.xsd',content:recursive}]})).toThrow(/Recursive|expansion/);
 });
 it('warns for PolicyReference-only security extensions', () => {
  const content = distributedWsdl.replace('<binding name="Binding"', '<binding xmlns:p="http://www.w3.org/ns/ws-policy" name="Binding"').replace('<s:binding','<p:PolicyReference URI="#Security"/><s:binding');
  expect(importApiDescription(content,{documents:bundle}).warnings.join(' ')).toMatch(/policy extensions.*not carried over/i);
 });
 it('warns for WSDL 2 SOAP modules that need manual security configuration', () => {
  const content = wsdl2.replace('<operation ref="t:Create"', '<s:module ref="urn:security" required="true"/><operation ref="t:Create"');
  expect(importApiDescription(content,{documents:bundle}).warnings.join(' ')).toMatch(/SOAP module.*not carried over/i);
 });
});
