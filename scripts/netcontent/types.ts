export interface EndpointParam {
  name: string;
  csType: string;        // raw C# type, e.g. "int", "double", "bool", "int?", "string"
  required: boolean;     // true when the signature has no default value
  defaultValue: string | null; // literal default text, e.g. "false", "null", "0"
}

export interface Endpoint {
  httpMethod: "GET" | "POST";
  route: string;         // verbatim from [Route("...")], e.g. "api/NetContentTareCheck/GetLastOpenTareCheck"
  controller: string;    // module/domain, e.g. "TareCheck"
  action: string;        // method name, e.g. "GetLastOpenTareCheck"
  params: EndpointParam[];
}

export interface ParseResult {
  endpoints: Endpoint[];
  warnings: string[];    // human-readable notes about skipped/odd actions
}
