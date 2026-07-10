import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildViewInventory, type ViewInventory } from './parse-views';

const DEFAULT_VIEWS_DIR =
  String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\Templates\Views`;

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function main() {
  const viewsDir = process.env.NETCONTENT_VIEWS_DIR || DEFAULT_VIEWS_DIR;
  if (!fs.existsSync(viewsDir)) {
    console.error(`Views directory not found: ${viewsDir}`);
    process.exit(1);
  }
  const inventories: ViewInventory[] = [];
  for (const html of walkHtml(viewsDir)) {
    const inv = buildViewInventory(html);
    if (inv.elements.length > 0) inventories.push(inv);
  }
  inventories.sort((a, b) => b.elements.length - a.elements.length);

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'views.inventory.json');
  fs.writeFileSync(outPath, JSON.stringify(inventories, null, 2), 'utf-8');

  const totalEls = inventories.reduce((n, v) => n + v.elements.length, 0);
  console.log(`Views with interactive elements: ${inventories.length}`);
  console.log(`Total interactive elements: ${totalEls}`);
  console.log(`Inventory written: ${outPath}`);
  console.log('\n--- per view (elements / controller-actions) ---');
  for (const v of inventories) {
    console.log(`  ${String(v.elements.length).padStart(3)} els / ${String(v.actions.length).padStart(3)} acts   ${v.view}`);
  }
}

main();
