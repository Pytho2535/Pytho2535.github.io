// Build a URL that respects the configured `base` (for GitHub Pages project
// sites). Pass a path like '/about' or 'images/foo.png'.
const BASE = import.meta.env.BASE_URL; // e.g. '/' or '/repo-name/'

export function url(path = '/'): string {
  const b = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}` || '/';
}
