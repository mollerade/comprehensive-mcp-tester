/**
 * The Makefile's install contract: a staged install lands in the right tree,
 * the installed `mcp-tester` command really serves the UI, and uninstall
 * removes everything it added. Skips where `make` is not installed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, openSync, fstatSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = spawnSync('make', ['--version']).status === 0 ? false : 'make is not installed';
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'install-'));
  made.push(d);
  return d;
}

function make(...args) {
  const r = spawnSync('make', ['-s', '-C', ROOT, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** Start the installed command on a free port; resolves with its base URL once it is listening */
function startInstalled(bin) {
  const child = spawn(bin, [], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' } });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('no startup line: ' + out)); }, 10000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = /running at (http:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ child, url: m[1] }); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('exited ' + code + ': ' + out)); });
  });
}

test('a staged install puts the command and the app under DESTDIR, pointing at PREFIX', { skip }, () => {
  const stage = tmp();
  make('install', 'DESTDIR=' + stage, 'PREFIX=/opt/mcp');
  const bin = join(stage, 'opt/mcp/bin/mcp-tester');
  // One open file for both checks, so the mode and the contents come from the same file
  const fd = openSync(bin, 'r');
  let mode, wrapper;
  try { mode = fstatSync(fd).mode; wrapper = readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
  assert.ok(mode & 0o111, 'mcp-tester is not executable');
  assert.match(wrapper, /^#!\/bin\/sh\nexec node "\/opt\/mcp\/lib\/mcp-tester\/src\/hosts\/node-server\.js" "\$@"\n$/);
  for (const f of ['src/hosts/node-server.js', 'src/ui/index.html', 'src/core/proxy.js', 'package.json']) {
    assert.ok(existsSync(join(stage, 'opt/mcp/lib/mcp-tester', f)), 'missing ' + f);
  }
  assert.ok(!readdirSync(join(stage, 'opt/mcp/lib/mcp-tester')).includes('tests'), 'tests were installed');
});

test('the installed command serves the UI, and uninstall removes it', { skip }, async () => {
  const prefix = join(tmp(), 'prefix');
  make('install', 'PREFIX=' + prefix);
  const bin = join(prefix, 'bin', 'mcp-tester');
  const { child, url } = await startInstalled(bin);
  try {
    const res = await fetch(url + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>[^<]*MCP Tester/);
  } finally {
    child.kill();
  }
  make('uninstall', 'PREFIX=' + prefix);
  assert.ok(!existsSync(bin));
  assert.ok(!existsSync(join(prefix, 'lib', 'mcp-tester')));
});
