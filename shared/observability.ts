import { z } from 'zod';

/** Which layer produced the failure. Drives the trigger shape and the repro strategy. */
export const INCIDENT_KINDS = ['server-api', 'client-runtime', 'job', 'runner'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ['open', 'fixed', 'ignored'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type ReproConfidence = 'high' | 'medium' | 'best-effort' | 'none';

/** One parsed stack frame. `app` marks frames belonging to this repository. */
export interface StackFrame {
  functionName: string | null;
  file: string;
  line: number;
  column: number;
  app: boolean;
}

/** The first app-owned frame, with the surrounding source read from disk. */
export interface IncidentOrigin {
  file: string;
  line: number;
  column: number;
  functionName: string | null;
  /** Formatted source lines; the failing one is prefixed with `>` instead of `|`. */
  source: string[];
  /** Set when the file could not be read, e.g. the commit moved underneath us. */
  unresolved?: string;
}

export interface IncidentOccurrence {
  ts: string;
  correlationId?: string;
  sessionId?: string;
  userId?: number;
}

export interface IncidentRepro {
  path: string;
  command: string;
  confidence: ReproConfidence;
  notes?: string;
}

export interface Incident {
  id: string;
  fingerprint: string;
  kind: IncidentKind;
  status: IncidentStatus;
  count: number;
  firstSeen: string;
  lastSeen: string;
  title: string;
  origin: IncidentOrigin | null;
  error: { name: string; message: string; frames: StackFrame[] };
  trigger: Record<string, unknown>;
  state: Record<string, unknown>;
  breadcrumbs: unknown[];
  occurrences: IncidentOccurrence[];
  repro?: IncidentRepro;
}

/** Compact row in `.observability/index.json`. */
export interface IncidentIndexEntry {
  id: string;
  kind: IncidentKind;
  status: IncidentStatus;
  title: string;
  count: number;
  lastSeen: string;
  file: string;
  reproPath?: string;
  reproConfidence?: ReproConfidence;
}

export const CLIENT_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'debug'] as const;
export type ClientLogLevel = (typeof CLIENT_LOG_LEVELS)[number];

export const ClientLogEntrySchema = z.object({
  level: z.enum(CLIENT_LOG_LEVELS),
  message: z.string().max(2000),
  /** Browser clock, kept alongside the server's own so skew is visible. */
  clientTs: z.string(),
  correlationId: z.string().max(100).optional(),
  route: z.string().max(500).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;

export const ClientLogBatchSchema = z.object({
  sessionId: z.string().min(1).max(100),
  entries: z.array(ClientLogEntrySchema).min(1).max(100),
  /** Entries the browser had to drop because its buffer was full. */
  dropped: z.number().int().nonnegative().optional(),
});
export type ClientLogBatch = z.infer<typeof ClientLogBatchSchema>;

export const ClientIncidentReportSchema = z.object({
  sessionId: z.string().min(1).max(100),
  correlationId: z.string().max(100).optional(),
  route: z.string().max(500).optional(),
  name: z.string().max(200),
  message: z.string().max(2000),
  stack: z.string().max(20000).optional(),
  componentStack: z.string().max(20000).optional(),
  /** Serialisable props captured by the error boundary, when it has them. */
  props: z.record(z.unknown()).optional(),
  breadcrumbs: z.array(z.record(z.unknown())).max(50).optional(),
});
export type ClientIncidentReport = z.infer<typeof ClientIncidentReportSchema>;
