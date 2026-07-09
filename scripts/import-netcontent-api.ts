import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../server/db';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
import { parseControllersDir } from './netcontent/parse-controllers';
import { mapEndpoints } from './netcontent/map-to-apitests';
import { resolveUserId, findOrCreateProject, importApiTests } from './netcontent/importer';

const DEFAULT_CONTROLLERS =
  String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\_NccNew\Controllers`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const controllersDir = process.env.NETCONTENT_CONTROLLERS_DIR || DEFAULT_CONTROLLERS;
  const baseUrlVar = process.env.NETCONTENT_BASE_URL_VAR || '{{baseUrl}}';
  const projectName = process.env.NETCONTENT_PROJECT_NAME || 'NetContent';
  const userOverride = process.env.WFM_IMPORT_USER_ID ? Number(process.env.WFM_IMPORT_USER_ID) : undefined;

  console.log(`Parsing controllers in: ${controllersDir}`);
  const { endpoints, warnings } = parseControllersDir(controllersDir);
  console.log(`Parsed ${endpoints.length} endpoints (${warnings.length} warnings).`);
  warnings.forEach((w) => console.warn(`  ! ${w}`));

  const manifestPath = path.join(scriptDir, 'netcontent', 'endpoints.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ endpoints, warnings }, null, 2), 'utf-8');
  console.log(`Manifest written: ${manifestPath}`);

  if (dryRun) {
    console.log('--dry-run: no database writes.');
    process.exit(0);
  }

  const userId = await resolveUserId(db, userOverride);
  const projectId = await findOrCreateProject(db, userId, projectName);
  const records = mapEndpoints(endpoints, { baseUrlVar, projectId, userId });
  const summary = await importApiTests(db, records, projectId);

  console.log(
    `Import complete -> project "${projectName}" (id=${projectId}, owner userId=${userId})\n` +
      `  created: ${summary.created}  updated: ${summary.updated}  orphans: ${summary.orphans.length}`,
  );
  summary.orphans.forEach((o) => console.log(`  orphan (no longer in controllers): ${o}`));
  process.exit(0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
