import { readFileSync, existsSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { join, dirname, basename, sep, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// npm's workspace lock can retain orphan transitive build tools in production.
// Remove only this known glob toolchain, after proving it is unreachable from
// the root application's production dependencies (including installed peers).
export function removeUnusedGlobTools(directory) {
  const root = realpathSync(directory);
  const modules = join(root, 'node_modules');
  const reachable = new Set();
  const lookup = (from, name, optional) => {
    if (!/^(?:@[^/.][^/]*\/)?[^/.][^/]*$/.test(name)) throw new Error(`Invalid dependency name: ${name}`);
    for (let base = from; base === root || base.startsWith(root + sep); base = dirname(base)) {
      if (basename(base) === 'node_modules') continue;
      const file = join(base, 'node_modules', name, 'package.json');
      if (existsSync(file)) {
        const dir = realpathSync(dirname(file));
        if (!dir.startsWith(modules + sep)) throw new Error(`Dependency escapes runtime tree: ${name}`);
        return dir;
      }
    }
    if (!optional) throw new Error(`Missing runtime dependency: ${name}`);
  };
  const visit = (dir, pkg) => {
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
    for (const name of Object.keys(dependencies)) {
      const optional = Object.hasOwn(pkg.optionalDependencies ?? {}, name) || pkg.peerDependenciesMeta?.[name]?.optional;
      const found = lookup(dir, name, optional);
      if (!found || reachable.has(found)) continue;
      reachable.add(found);
      visit(found, JSON.parse(readFileSync(join(found, 'package.json'), 'utf8')));
    }
  };
  visit(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
  const targets = ['fast-glob', 'micromatch', 'braces'].map(name => join(modules, name));
  // Validate every target before deleting any, so failure cannot partially prune.
  for (const target of targets) {
    if (!existsSync(target)) continue;
    if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) throw new Error(`Unsafe runtime target: ${target}`);
    if (reachable.has(target)) throw new Error(`Runtime requires ${target}`);
  }
  for (const target of targets) if (existsSync(target)) rmSync(target, { recursive: true });
  console.log('Removed unreachable client glob build tools from runtime');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) removeUnusedGlobTools(process.cwd());
