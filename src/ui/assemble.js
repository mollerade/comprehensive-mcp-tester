/**
 * Assembles the single-page UI from its source files.
 *
 * The UI ships as ONE self-contained HTML document (styles and scripts
 * inlined) so every host can serve it from a single string: the Cloudflare
 * Worker embeds it at build time, the Node host assembles it per request.
 *
 * JS files are classic scripts sharing one global scope, concatenated in the
 * order listed in js/ORDER.json. Order matters only for top-level statements
 * (state.js first, main.js last); functions are hoisted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UI_DIR = dirname(fileURLToPath(import.meta.url));

export function jsOrder() {
  return JSON.parse(readFileSync(join(UI_DIR, 'js', 'ORDER.json'), 'utf8'));
}

/** Concatenated client JS, exactly as it appears inside the page's <script>. */
export function assembleJs() {
  return jsOrder().map((f) => readFileSync(join(UI_DIR, 'js', f), 'utf8')).join('');
}

export function assembleHtml() {
  const tpl = readFileSync(join(UI_DIR, 'index.html'), 'utf8');
  const css = readFileSync(join(UI_DIR, 'styles.css'), 'utf8');
  const js = assembleJs();
  if (!tpl.includes('<!-- @inline-css -->') || !tpl.includes('<!-- @inline-js -->')) {
    throw new Error('index.html is missing an @inline-css or @inline-js marker');
  }
  // Function replacers so "$" sequences in the sources are never treated as patterns
  return tpl
    .replace('<!-- @inline-css -->', () => '<style>\n' + css + '</style>')
    .replace('<!-- @inline-js -->', () => '<script>\n' + js + '</script>');
}
