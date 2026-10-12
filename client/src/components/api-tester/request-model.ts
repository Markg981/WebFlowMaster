import type { Assertion } from '@shared/schema';

/**
 * The shapes the API tester's request editor works with, shared by the page and the editors
 * it is made of.
 */

// WEBSOCKET and GRPC are not HTTP methods: the runner opens a connection of that kind instead
// (server/api-tests/api-protocols.ts). The URL says where: ws(s):// or grpc(s)://host:port/package.Service/Method.
export const httpMethods = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'WEBSOCKET',
  'GRPC',
];

export const bodyTypes = [
  'none',
  'form-data',
  'x-www-form-urlencoded',
  'raw',
  'binary',
  'GraphQL',
] as const;
export type BodyType = (typeof bodyTypes)[number];

export const bodyTypeDisplayMap: Record<BodyType, string> = {
  none: 'None',
  'form-data': 'Form Data',
  'x-www-form-urlencoded': 'x-www-form-urlencoded',
  raw: 'Raw (JSON, XML, Text, etc.)',
  binary: 'Binary',
  GraphQL: 'GraphQL',
};

export type AssertionResult = {
  assertion: Assertion;
  pass: boolean;
  actualValue: any;
  error?: string;
};

export interface ProxyResponse {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  duration?: number;
  error?: string;
  details?: any;
  assertionResults?: AssertionResult[];
  /** What this run captured, and what it looked for and did not find. */
  extracted?: Record<string, string>;
  extractionErrors?: Array<{ name: string; reason: string }>;
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface FormDataField {
  id: string;
  key: string;
  value: string | File | null; // File for type 'file', string for type 'text'
  enabled: boolean;
  type: 'text' | 'file';
}

/** A form-data part as the proxy receives it (server/api-tests/api-test-runner.ts, MultipartPart). */
export type MultipartPart =
  | { key: string; type: 'text'; value: string }
  | { key: string; type: 'file'; fileName: string; contentType: string; base64: string };

/** A file's bytes as base64, without the `data:…;base64,` prefix a data URL carries. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
