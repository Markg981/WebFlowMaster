import fs from 'fs';
import path from 'path';
import type { Endpoint, EndpointParam, ParseResult } from './types';

// Splits a C# parameter list on top-level commas (ignores commas inside <...> generics).
function splitTopLevel(paramStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramStr) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function parseParams(paramStr: string): EndpointParam[] {
  const trimmed = paramStr.trim();
  if (!trimmed) return [];
  return splitTopLevel(trimmed).map((raw) => {
    // Drop C# parameter attributes like [FromBody] / [FromQuery].
    let p = raw.replace(/\[[^\]]*\]/g, '').trim();
    let defaultValue: string | null = null;
    const eq = p.indexOf('=');
    if (eq !== -1) {
      defaultValue = p.slice(eq + 1).trim();
      p = p.slice(0, eq).trim();
    }
    // Remaining is "<type-with-maybe-spaces> <name>"; the name is the last token.
    const tokens = p.split(/\s+/);
    const name = tokens.pop() as string;
    const csType = tokens.join(' ');
    return { name, csType, required: defaultValue === null, defaultValue };
  });
}

// Matches: [HttpGet]/[HttpPost] ... [Route("...")] ... public <ret> <Name>( <params> )
// The gaps tolerate interleaved attributes, `//` line comments and `/* */` block
// comments between the attributes and the method signature.
const SKIP = String.raw`(?:\s|\[[^\]]*\]|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*?`;
const ACTION_RE = new RegExp(
  String.raw`\[Http(Get|Post)\]` +
    SKIP +
    String.raw`\[Route\("([^"]+)"\)\]` +
    SKIP +
    String.raw`public\s+[\w<>?,.\[\]\s]+?\s+(\w+)\s*\(([^)]*)\)`,
  'gs',
);

export function parseControllerSource(
  source: string,
  controller: string,
): { endpoints: Endpoint[]; warnings: string[] } {
  const endpoints: Endpoint[] = [];
  const warnings: string[] = [];
  let m: RegExpExecArray | null;
  ACTION_RE.lastIndex = 0;
  while ((m = ACTION_RE.exec(source)) !== null) {
    const [, verb, route, action, paramStr] = m;
    endpoints.push({
      httpMethod: verb.toUpperCase() === 'GET' ? 'GET' : 'POST',
      route,
      controller,
      action,
      params: parseParams(paramStr),
    });
  }
  // Flag actions that carry an HTTP verb but no [Route] (convention routing not supported).
  const verbCount = (source.match(/\[Http(Get|Post)\]/g) || []).length;
  if (verbCount > endpoints.length) {
    warnings.push(
      `${controller}: ${verbCount - endpoints.length} action(s) with [HttpGet]/[HttpPost] but no adjacent [Route(...)] were skipped.`,
    );
  }
  return { endpoints, warnings };
}

export function moduleFromPath(filePath: string, controllersRoot: string): string {
  const rel = path.relative(controllersRoot, filePath);
  const segments = rel.split(path.sep);
  if (segments.length > 1) {
    return segments[0]; // subfolder domain, e.g. "TareCheck"
  }
  // Directly under Controllers: "CommonNccController.cs" -> "Common".
  return path
    .basename(filePath, '.cs')
    .replace(/Controller$/, '')
    .replace(/^Ncc/, '');
}

function walkCsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.cs')) out.push(full);
  }
  return out;
}

export function parseControllersDir(controllersRoot: string): ParseResult {
  if (!fs.existsSync(controllersRoot)) {
    throw new Error(`Controllers directory not found: ${controllersRoot}`);
  }
  const endpoints: Endpoint[] = [];
  const warnings: string[] = [];
  for (const file of walkCsFiles(controllersRoot)) {
    const source = fs.readFileSync(file, 'utf-8');
    const controller = moduleFromPath(file, controllersRoot);
    const res = parseControllerSource(source, controller);
    endpoints.push(...res.endpoints);
    warnings.push(...res.warnings);
  }
  return { endpoints, warnings };
}
