/** INSTALLATION_ADMINS parsing: pure, so the startup check can use it without the database. */
export function installationAdmins(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.INSTALLATION_ADMINS?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
}

/** Startup check: entries are usernames or emails; empty entries and duplicates (ignoring case) are rejected. */
export function installationAdminsErrors(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const entry of raw.split(',')) {
    const name = entry.trim().toLowerCase();
    if (!name) errors.push('INSTALLATION_ADMINS contains an empty entry.');
    else if (/\s/.test(name))
      errors.push(`INSTALLATION_ADMINS entry "${name}" contains whitespace.`);
    else if (seen.has(name)) errors.push(`INSTALLATION_ADMINS lists "${name}" more than once.`);
    seen.add(name);
  }
  return errors;
}
