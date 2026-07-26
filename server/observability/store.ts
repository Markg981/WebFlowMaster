import fs from 'node:fs/promises';
import path from 'node:path';
import type { Incident, IncidentIndexEntry } from '../../shared/observability';

export const MAX_INCIDENT_FILES = 200;
export const MAX_INCIDENT_AGE_DAYS = 30;
/** Occurrences kept per incident. The count keeps rising; the list does not. */
export const MAX_OCCURRENCES = 10;

/**
 * Filesystem-backed incident storage.
 *
 * One file per fingerprint, so a recurrence updates a file rather than adding one, plus a
 * compact index so the whole picture is one read away.
 */
export class IncidentStore {
  private readonly incidentsDir: string;
  private readonly indexPath: string;
  /** Serialises writes: concurrent requests must not interleave index read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {
    this.incidentsDir = path.join(rootDir, 'incidents');
    this.indexPath = path.join(rootDir, 'index.json');
  }

  private serialise<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private filePath(id: string): string {
    return path.join(this.incidentsDir, `${id}.json`);
  }

  private async writeJson(target: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a reader never sees a half-written file.
    const temp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rm(target, { force: true });
    await fs.rename(temp, target);
  }

  async read(id: string): Promise<Incident | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as Incident;
    } catch {
      return null;
    }
  }

  async readIndex(): Promise<IncidentIndexEntry[]> {
    try {
      return JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as IncidentIndexEntry[];
    } catch {
      return [];
    }
  }

  async upsert(incoming: Incident): Promise<Incident> {
    return this.serialise(async () => {
      const existing = await this.read(incoming.id);

      const merged: Incident = existing
        ? {
            ...incoming,
            firstSeen: existing.firstSeen,
            count: existing.count + incoming.count,
            // A status set by hand (fixed / ignored) outlives a recurrence.
            status: existing.status === 'open' ? incoming.status : existing.status,
            occurrences: [...existing.occurrences, ...incoming.occurrences].slice(-MAX_OCCURRENCES),
            repro: incoming.repro ?? existing.repro,
          }
        : incoming;

      await this.writeJson(this.filePath(merged.id), merged);
      await this.reindex(merged);
      return merged;
    });
  }

  private async reindex(incident: Incident): Promise<void> {
    const index = (await this.readIndex()).filter((entry) => entry.id !== incident.id);
    index.push({
      id: incident.id,
      kind: incident.kind,
      status: incident.status,
      title: incident.title,
      count: incident.count,
      lastSeen: incident.lastSeen,
      file: `incidents/${incident.id}.json`,
      reproPath: incident.repro?.path,
      reproConfidence: incident.repro?.confidence,
    });
    index.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    await this.writeJson(this.indexPath, index);
  }

  /** Returns how many incidents were removed. */
  async prune(options: { maxFiles?: number; maxAgeDays?: number } = {}): Promise<number> {
    const maxFiles = options.maxFiles ?? MAX_INCIDENT_FILES;
    const maxAgeDays = options.maxAgeDays ?? MAX_INCIDENT_AGE_DAYS;

    return this.serialise(async () => {
      const index = await this.readIndex();
      const cutoff = Date.now() - maxAgeDays * 24 * 3600_000;

      const tooOld = new Set(
        index.filter((e) => Date.parse(e.lastSeen) < cutoff).map((e) => e.id),
      );

      // Over the cap: fixed incidents go first, then the least recently seen.
      const survivors = index.filter((e) => !tooOld.has(e.id));
      const ranked = [...survivors].sort((a, b) => {
        const aFixed = a.status === 'fixed' ? 1 : 0;
        const bFixed = b.status === 'fixed' ? 1 : 0;
        if (aFixed !== bFixed) return bFixed - aFixed;
        return Date.parse(a.lastSeen) - Date.parse(b.lastSeen);
      });
      const overflow = new Set(ranked.slice(0, Math.max(0, survivors.length - maxFiles)).map((e) => e.id));

      const doomed = [...tooOld, ...overflow];
      for (const id of doomed) {
        await fs.rm(this.filePath(id), { force: true });
      }

      if (doomed.length > 0) {
        await this.writeJson(this.indexPath, index.filter((e) => !doomed.includes(e.id)));
      }
      return doomed.length;
    });
  }
}
