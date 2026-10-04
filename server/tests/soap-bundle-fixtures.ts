export const distributedWsdl = `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:s="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:t="urn:service" xmlns:r="urn:request" xmlns:x="http://www.w3.org/2001/XMLSchema" name="Orders" targetNamespace="urn:service">
 <types><x:schema targetNamespace="urn:service"><x:import namespace="urn:request" schemaLocation="types/request.xsd"/></x:schema></types>
 <message name="Request"><part name="body" element="r:Order"/></message>
 <portType name="Port"><operation name="Create"><input message="t:Request"/><output message="t:Request"/></operation></portType>
 <binding name="Binding" type="t:Port"><s:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/><operation name="Create"><s:operation soapAction="urn:create"/><input><s:body use="literal"/></input></operation></binding>
 <service name="Service"><port name="Primary" binding="t:Binding"><s:address location="https://user:password@orders.example/soap"/></port><port name="Backup" binding="t:Binding"><s:address location="https://backup.example/soap"/></port></service>
</definitions>`;
export const requestXsd = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" xmlns:r="urn:request" targetNamespace="urn:request" elementFormDefault="qualified">
 <x:include schemaLocation="base.xsd"/>
 <x:element name="Order" type="r:OrderType"/>
 <x:complexType name="OrderType"><x:complexContent><x:extension base="r:Base"><x:sequence><x:element ref="r:Details"/></x:sequence></x:extension></x:complexContent></x:complexType>
 <x:element name="Details"><x:complexType><x:sequence><x:element name="Note" type="x:string"/></x:sequence></x:complexType></x:element>
</x:schema>`;
export const baseXsd = `<x:schema xmlns:x="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:request" elementFormDefault="qualified"><x:complexType name="Base"><x:sequence><x:element name="OrderId" type="x:string"/></x:sequence></x:complexType></x:schema>`;
export const bundle = [{location:'types/request.xsd',content:requestXsd},{location:'types/base.xsd',content:baseXsd}];
export const wsdl2 = `<description xmlns="http://www.w3.org/ns/wsdl" xmlns:t="urn:v2" xmlns:r="urn:request" xmlns:x="http://www.w3.org/2001/XMLSchema" xmlns:s="http://www.w3.org/ns/wsdl/soap" targetNamespace="urn:v2">
 <types><x:schema><x:import namespace="urn:request" schemaLocation="types/request.xsd"/></x:schema></types>
 <interface name="Orders"><operation name="Create" pattern="http://www.w3.org/ns/wsdl/in-out"><input element="r:Order"/><output element="r:Order"/></operation><operation name="Notify" pattern="http://www.w3.org/ns/wsdl/in-only"><input element="r:Order"/></operation></interface>
 <binding name="Soap" interface="t:Orders" type="http://www.w3.org/ns/wsdl/soap" s:protocol="http://www.w3.org/2003/05/soap/bindings/HTTP/"><operation ref="t:Create" s:action="urn:create"/><operation ref="t:Notify" s:action="urn:notify"/></binding>
 <service name="OrdersService" interface="t:Orders"><endpoint name="Primary" binding="t:Soap" address="https://orders.example/v2"/></service>
</description>`;
