import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const catalogDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'casi');

const number = (id) => Number(id.slice(id.indexOf('-') + 1));

/**
 * Builds the catalogue from collaudo/casi: one file per case, so two pull requests that add cases
 * never edit the same lines. The counts in the preparation text are filled in here, never by hand.
 */
export async function loadCatalog(directory = catalogDirectory) {
  const { version, areas } = JSON.parse(
    await readFile(resolve(directory, 'catalogo.json'), 'utf8'),
  );
  const order = new Map(areas.map((area, index) => [area.id, index]));
  const cases = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!order.has(entry.name)) throw new Error(`collaudo/casi/${entry.name}: area sconosciuta`);
    for (const file of await readdir(resolve(directory, entry.name))) {
      const item = JSON.parse(await readFile(resolve(directory, entry.name, file), 'utf8'));
      if (
        file !== `${item.id}.json` ||
        item.area !== entry.name ||
        !item.id.startsWith(`${item.area}-`)
      )
        throw new Error(
          `collaudo/casi/${entry.name}/${file}: id o area non corrispondono al percorso`,
        );
      cases.push(item);
    }
  }
  cases.sort((a, b) => order.get(a.area) - order.get(b.area) || number(a.id) - number(b.id));
  const counts = { versione: version, casi: cases.length, aree: areas.length };
  const preparationHtml = (await readFile(resolve(directory, 'preparazione.html'), 'utf8')).replace(
    /\{\{(versione|casi|aree)\}\}/g,
    (_, key) => String(counts[key]),
  );
  const css = await readFile(resolve(directory, 'stile.css'), 'utf8');
  return { version, areas, cases, presentation: { css, preparationHtml } };
}
