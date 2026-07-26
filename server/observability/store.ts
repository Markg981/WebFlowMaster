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
    // this.queue is reassigned below through a handler that always resolves, so it
    // never rejects; the operation is therefore always run as the onFulfilled branch.
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private filePath(id: string): string {
    return path.join(this.incidentsDir, `${id}.json`);
  }

  private async writeJson(target: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a reader never sees a half-written file. The temp name is
    // unique per call so concurrent writes within one process cannot collide.
    const temp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');

    // fs.rename replaces an existing destination atomically (MoveFileEx with
    // replace-existing on Windows), so there is no need to delete `target` first — doing
    // so would only create a window where concurrent readers see it as missing, and would
    // strand the new data in the temp file if the rename then failed.
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // On Windows, an antivirus scanner or the file indexer can briefly hold a handle
        // open; a short bounded retry rides that out instead of losing the write.
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= maxAttempts) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No index yet: legitimately empty.
        return [];
      }
      // index.json exists but is corrupt or unreadable. Returning [] here would make
      // every already-recorded incident unreachable the moment the next upsert rewrites
      // the index from this "empty" view. The incident files are the source of truth, so
      // rebuild from them instead.
      return this.rebuildIndexFromIncidents();
    }
  }

  private toIndexEntry(incident: Incident): IncidentIndexEntry {
    return {
      id: incident.id,
      kind: incident.kind,
      status: incident.status,
      title: incident.title,
      count: incident.count,
      lastSeen: incident.lastSeen,
      file: `incidents/${incident.id}.json`,
      reproPath: incident.repro?.path,
      reproConfidence: incident.repro?.confidence,
    };
  }

  private async rebuildIndexFromIncidents(): Promise<IncidentIndexEntry[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.incidentsDir);
    } catch {
      // No incidents directory either: nothing to rebuild from.
      return [];
    }

    const entries: IncidentIndexEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.incidentsDir, file), 'utf8');
        entries.push(this.toIndexEntry(JSON.parse(raw) as Incident));
      } catch {
        // One unreadable/unparseable incident file must not sink the whole rebuild.
      }
    }
    entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    return entries;
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
    index.push(this.toIndexEntry(incident));
    index.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    await this.writeJson(this.indexPath, index);
  }

  /** Returns how many incidents were actually removed from disk. */
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

      const doomed = new Set([...tooOld, ...overflow]);

      // Attempt every deletion rather than bailing on the first failure, so one locked
      // file cannot leave the rest deleted-on-disk but still listed in the index (or vice
      // versa). Ids whose file could not be removed stay in the index.
      const failedToRemove = new Set<string>();
      let removedCount = 0;
      for (const id of doomed) {
        try {
          // No `force`: a genuine deletion is distinguished from a no-op on an already-
          // absent file, so the returned count reflects what this call actually removed.
          await fs.rm(this.filePath(id));
          removedCount++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // Already gone; the stale index entry should still be dropped below, but this
            // call didn't remove anything.
            continue;
          }
          failedToRemove.add(id);
        }
      }

      if (doomed.size > 0) {
        await this.writeJson(
          this.indexPath,
          index.filter((e) => !doomed.has(e.id) || failedToRemove.has(e.id)),
        );
      }
      return removedCount;
    });
  }
}
