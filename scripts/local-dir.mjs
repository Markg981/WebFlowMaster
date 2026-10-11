// Where local tooling writes what it produces (E2E reports, drill and resilience evidence,
// backups, scratch bundles): one ignored folder instead of one per tool at the repository
// root. WFM_LOCAL_DIR moves it, as an absolute path or one relative to the working directory.
//
// Application state is not tooling output and stays where the image expects it: data/,
// results/, uploads/, logs/ and allure-results/ are the volumes mounted under /app.
import path from 'node:path';

export function localDir(...parts) {
  return path.resolve(process.env.WFM_LOCAL_DIR || '.local', ...parts);
}
