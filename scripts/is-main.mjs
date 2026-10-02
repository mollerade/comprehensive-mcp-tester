/**
 * Whether a module is the one Node was asked to run.
 *
 *   if (isMain(import.meta.url)) main(process.argv.slice(2));
 *
 * Node resolves import.meta.url through symlinks but leaves process.argv[1]
 * as typed, so comparing them directly fails for a script reached through a
 * symlinked path (macOS /tmp, a symlinked home or checkout) and the script
 * exits 0 having done nothing. Comparing real paths does not.
 * src/hosts/node-server.js carries its own copy: src/ must not import scripts/.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try { return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}
