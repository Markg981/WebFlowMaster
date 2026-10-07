import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { importApiDescription } from './api-import';
import { expandedDocuments, expandedWsdl } from './tests/soap-expanded-fixtures';
import { distributedWsdl, wsdl2 } from './tests/soap-bundle-fixtures';

const schema = (body: string) =>
  `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" xmlns:r="urn:request" targetNamespace="urn:request" elementFormDefault="qualified"><x:element name="Order"><x:complexType>${body}</x:complexType></x:element></x:schema>`;
const parse = (body: string) =>
  importApiDescription(distributedWsdl, {
    documents: [{ location: 'types/request.xsd', content: schema(body) }],
  });

describe('expanded document/literal skeletons', () => {
  it('does not expand or warn about unselected choice alternatives', () => {
    const test = parse(
      '<x:choice><x:element name="Selected"/><x:element name="NotSelected" minOccurs="0" maxOccurs="unbounded"/></x:choice>',
    ).tests[0];
    expect(test.requestBody).toContain('<ns:Selected>');
    expect(test.requestBody).not.toContain('NotSelected');
    expect(test.warnings.join(' ')).not.toContain('repeated particle');
  });
  it('bounds scans of disabled choice alternatives as well as generated particles', () => {
    const disabled = '<x:element name="Disabled" minOccurs="0" maxOccurs="0"/>'.repeat(5001);
    expect(() => parse(`<x:choice>${disabled}<x:element name="Selected"/></x:choice>`)).toThrow(
      /5000/,
    );
  });
  it('imports a repeated choice with many unused branches within a finite budget', () => {
    const unused = '<x:element name="Unused" minOccurs="0" maxOccurs="unbounded"/>'.repeat(10000);
    const test = parse(
      `<x:choice minOccurs="100" maxOccurs="100"><x:element name="Selected"/>${unused}</x:choice>`,
    ).tests[0];
    expect(test.requestBody!.match(/<ns:Selected>/g)).toHaveLength(100);
    expect(test.requestBody).not.toContain('Unused');
    expect(test.warnings).toHaveLength(2);
  });
  it('charges disabled children inside repeated sequences to the work budget', () => {
    const disabled = '<x:element name="Disabled" minOccurs="0" maxOccurs="0"/>'.repeat(100);
    expect(() =>
      parse(`<x:sequence minOccurs="100" maxOccurs="100">${disabled}</x:sequence>`),
    ).toThrow(/5000/);
  });
  it('imports the shared synthetic bundle with nested groups, choices and occurrences', () => {
    const result = importApiDescription(expandedWsdl, { documents: expandedDocuments });
    const test = result.tests[0];
    const errors: string[] = [];
    const doc = new DOMParser({
      errorHandler: {
        warning: (m) => errors.push(m),
        error: (m) => errors.push(m),
        fatalError: (m) => errors.push(m),
      },
    }).parseFromString(test.requestBody!, 'text/xml');
    expect(errors).toEqual([]);
    expect(doc.getElementsByTagNameNS('urn:common', 'OrderId')).toHaveLength(1);
    expect(doc.getElementsByTagNameNS('urn:common', 'AddressId')).toHaveLength(1);
    expect(doc.getElementsByTagNameNS('urn:request', 'Sku')).toHaveLength(1);
    expect(doc.getElementsByTagNameNS('urn:request', 'Line')).toHaveLength(2);
    expect(test.requestBody).not.toContain('ServiceCode');
    expect(test.requestBody).not.toContain('AddressText');
    expect(test.requestBody).toContain('<!-- XSD any');
    expect(test.warnings.join(' ')).toMatch(/choice.*first alternative/i);
    expect(test.warnings.join(' ')).toMatch(/wildcard.*##other.*lax/i);
    expect(test.warnings.join(' ')).toMatch(/attributes.*manual/i);
  });
  it('supports nested all and sequence in WSDL 2 SOAP 1.2', () => {
    const content = schema(
      '<x:sequence><x:element name="Address"><x:complexType><x:all><x:element name="City" type="x:string"/><x:element name="Zip" type="x:string"/></x:all></x:complexType></x:element></x:sequence>',
    );
    const result = importApiDescription(wsdl2, {
      documents: [{ location: 'types/request.xsd', content }],
    });
    expect(result.tests[0].requestBody).toMatch(/Address>[\s\S]*City>[\s\S]*Zip>/);
    expect(result.tests[0].requestHeaders!['Content-Type']).toContain('application/soap+xml');
  });
  it('omits disabled particles, includes one optional sample and respects element minOccurs', () => {
    const test = parse(
      '<x:sequence><x:sequence maxOccurs="0" minOccurs="0"><x:element name="Disabled"/></x:sequence><x:element name="Optional" minOccurs="0"/><x:element name="Repeated" minOccurs="3" maxOccurs="3"/></x:sequence>',
    ).tests[0];
    expect(test.requestBody).not.toContain('Disabled');
    expect(test.requestBody).toContain('<ns:Optional>');
    expect(test.requestBody!.match(/<ns:Repeated>/g)).toHaveLength(3);
  });
  it('resolves group refs in chameleon includes and honours unqualified locals', () => {
    const request = schema('<x:group ref="r:Fields"/>').replace(
      '<x:element name="Order">',
      '<x:include schemaLocation="fields.xsd"/><x:element name="Order">',
    );
    const fields =
      '<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema"><x:group name="Fields"><x:sequence><x:group ref="Nested"/></x:sequence></x:group><x:group name="Nested"><x:all><x:element name="Local"/></x:all></x:group></x:schema>';
    expect(
      importApiDescription(distributedWsdl, {
        documents: [
          { location: 'types/request.xsd', content: request },
          { location: 'types/fields.xsd', content: fields },
        ],
      }).tests[0].requestBody,
    ).toContain('<Local>?</Local>');
  });
  it('rejects missing and conflicting groups', () => {
    expect(() => parse('<x:group ref="r:Missing"/>')).toThrow(/Missing.*group/);
    const content = schema('<x:group ref="r:G"/>').replace(
      '</x:schema>',
      '<x:group name="G"><x:sequence/></x:group><x:group name="G"><x:sequence/></x:group></x:schema>',
    );
    expect(() =>
      importApiDescription(distributedWsdl, {
        documents: [{ location: 'types/request.xsd', content }],
      }),
    ).toThrow(/Conflicting/);
  });
  it('bounds recursive groups, particle depth and explosive occurrences', () => {
    const content = schema('<x:group ref="r:G"/>').replace(
      '</x:schema>',
      '<x:group name="G"><x:sequence><x:group ref="r:G"/></x:sequence></x:group></x:schema>',
    );
    expect(() =>
      importApiDescription(distributedWsdl, {
        documents: [{ location: 'types/request.xsd', content }],
      }),
    ).toThrow(/Recursive/);
    expect(() =>
      parse('<x:sequence>'.repeat(40) + '<x:element name="Deep"/>' + '</x:sequence>'.repeat(40)),
    ).toThrow(/deep|depth/i);
    expect(() =>
      parse(
        '<x:sequence><x:element name="Many" minOccurs="5001" maxOccurs="unbounded"/></x:sequence>',
      ),
    ).toThrow(/5000/);
  });
  it.each(['-1', 'NaN', '1.5'])('rejects invalid occurrences %s', (value) => {
    expect(() =>
      parse(`<x:sequence minOccurs="${value}"><x:element name="Field"/></x:sequence>`),
    ).toThrow(/occurr/i);
  });
  it('keeps RPC, encoded and complex restrictions explicitly unsupported', () => {
    expect(() =>
      importApiDescription(expandedWsdl.replace('style="document"', 'style="rpc"'), {
        documents: expandedDocuments,
      }),
    ).toThrow(/RPC/);
    expect(() =>
      importApiDescription(expandedWsdl.replace('use="literal"', 'use="encoded"'), {
        documents: expandedDocuments,
      }),
    ).toThrow(/Encoded/);
    expect(() =>
      parse(
        '<x:complexContent><x:restriction base="x:anyType"><x:sequence/></x:restriction></x:complexContent>',
      ),
    ).toThrow(/restriction/);
  });
});
