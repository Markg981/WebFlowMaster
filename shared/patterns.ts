/**
 * The wildcard patterns of run comparison: URL patterns of network checkpoints and of the
 * comparison policy, and the path pattern of a known difference.
 */

const escapeRegex = (c: string) => c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * A URL pattern in the syntax of `mockRequest`: `**` any characters, `*` any but `/`, over the
 * whole URL (or path). A pattern with no wildcard matches a URL that contains it.
 */
export function urlPatternMatcher(pattern: string): (url: string) => boolean {
  const p = pattern.trim();
  if (!p.includes('*')) return (url) => url.includes(p);
  let source = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*' && p[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (p[i] === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegex(p[i]);
    }
  }
  const regex = new RegExp(`^${source}$`);
  return (url) => regex.test(url);
}

/**
 * The path pattern of a known difference, over a difference path such as `texts[3]` or
 * `series[Sales].points[Mar]`: `*` stands for any characters, everything else is literal, and the
 * whole path must match. An empty pattern matches any path.
 */
export function pathPatternMatcher(pattern: string | null | undefined): (path: string) => boolean {
  const p = (pattern ?? '').trim();
  if (p === '') return () => true;
  const regex = new RegExp(`^${p.split('*').map(escapeRegex).join('.*')}$`, 's');
  return (path) => regex.test(path);
}
