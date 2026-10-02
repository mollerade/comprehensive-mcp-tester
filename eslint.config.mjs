/**
 * ESLint configuration. The toolchain lives in tools/lint (its own package and
 * lockfile) so the project's install stays Playwright only; run `npm ci --prefix
 * tools/lint` once, then `npm run lint`. See docs/adr/0007-lint-gate.md.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireFromLint = createRequire(new URL('./tools/lint/package.json', import.meta.url));
const load = async (name) => (await import(pathToFileURL(requireFromLint.resolve(name)).href)).default;
const js = await load('@eslint/js');
const sonarjs = await load('eslint-plugin-sonarjs');
const globals = await load('globals');

/* The per-function ceilings every change must meet; existing offenders are listed in
   tools/lint/complexity-baseline.json, which may only shrink. */
export const CEILINGS = {
  complexity: ['error', 10],
  'sonarjs/cognitive-complexity': ['error', 15],
  'max-lines-per-function': ['error', 60],
  'max-lines': ['error', 500],
};

export default [
  { ignores: ['dist/**', 'build/**', 'reports/**', 'node_modules/**', 'tools/lint/node_modules/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    plugins: { sonarjs },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    // An empty catch is this codebase's way to say "best effort" (storage, pop-ups, history); other empty blocks still fail
    rules: { ...js.configs.recommended.rules, 'no-empty': ['error', { allowEmptyCatch: true }], ...CEILINGS },
  },
  {
    // Server side, build and tests: modern ES modules on Node
    files: ['**/*.mjs', 'src/core/**/*.js', 'src/hosts/**/*.js', 'src/ui/assemble.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Callbacks passed to page.evaluate() run in the browser under test
    files: ['tests/e2e.test.mjs', 'tests/e2e-access.test.mjs', 'tests/fixtures/e2e-harness.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The client: ES5 classic scripts sharing one global scope (ADR 0002), so `let`, `const`,
    // `import` and `export` are syntax errors here. A name defined in one file is used in
    // another, so per-file undefined/unused checks cannot judge them.
    files: ['src/ui/js/**/*.js'],
    languageOptions: { ecmaVersion: 5, sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off' },
  },
];
