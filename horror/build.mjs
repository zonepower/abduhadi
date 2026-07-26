#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bundles the game into a single self-contained `game.html`.
//
// The modular sources need an HTTP server (ES modules are blocked on file://).
// This flattens every module into one script so the game can also be opened by
// double-clicking the file, with no server and no network.
//
//   node build.mjs
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// dependency order — a module may only reference names declared above it
const MODULES = [
  'src/engine/textures.js',
  'src/engine/shaders.js',
  'src/engine/renderer.js',
  'src/engine/input.js',
  'src/engine/audio.js',
  'src/engine/vocals.js',
  'src/engine/voice.js',
  'src/engine/cinema.js',
  'src/game/builder.js',
  'src/game/environment.js',
  'src/game/levels.js',
  'src/game/player.js',
  'src/game/weapons.js',
  'src/game/enemies.js',
  'src/game/boss.js',
  'src/game/hud.js',
  'src/game/story.js',
  'src/game/game.js',
  'src/main.js',
];

/** Strips module syntax so the file can be concatenated into one scope. */
function flatten(source) {
  return source
    .replace(/^import\b[^;]*;/gm, '')            // import ... from '...';
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '') // export { a, b };
    .replace(/^export\s+(?=(?:const|let|var|function|class|async))/gm, '');
}

/** Turns three's single trailing `export { ... }` into a THREE namespace. */
function flattenThree(source) {
  const match = source.match(/export\s*\{([\s\S]*?)\};?\s*$/);
  if (!match) throw new Error('could not find the three.js export block');
  const names = match[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.includes(' as ') ? n.split(/\s+as\s+/).map((s) => s.trim()).join(': ') : n));
  return `${source.slice(0, match.index)}\nconst THREE = { ${names.join(', ')} };\n`;
}

const escapeClose = (code) => code.replace(/<\/script/gi, '<\\/script');

async function main() {
  const three = flattenThree(await readFile(resolve(ROOT, 'vendor/three.module.js'), 'utf8'));
  const css = await readFile(resolve(ROOT, 'styles.css'), 'utf8');
  const html = await readFile(resolve(ROOT, 'index.html'), 'utf8');

  const bundle = [];
  for (const file of MODULES) {
    // eslint-disable-next-line no-await-in-loop
    const source = await readFile(resolve(ROOT, file), 'utf8');
    bundle.push(`\n/* ===== ${file} ===== */\n${flatten(source)}`);
  }

  // The game modules live in their own nested scope so their helper names
  // (lerp, clamp, …) shadow three's internals instead of colliding with them.
  const script = [
    "(function () {\n'use strict';",
    three,
    '(function (THREE) {',
    bundle.join('\n'),
    '})(THREE);',
    '})();',
  ].join('\n');

  // NOTE: replacer *functions*, not strings — the bundled code contains `$'`
  // and `$&`, which String.replace would otherwise treat as substitutions.
  const out = html
    .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
    .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`)
    .replace(
      '<script type="module" src="src/main.js"></script>',
      () => `<script>\n${escapeClose(script)}\n</script>`
    );

  const args = process.argv.slice(2);
  const artifactIndex = args.indexOf('--artifact');

  if (artifactIndex === -1) {
    await writeFile(resolve(ROOT, 'game.html'), out, 'utf8');
    const kb = Math.round(Buffer.byteLength(out) / 1024);
    console.log(`game.html written (${kb} KB) — open it directly, no server needed.`);
    return;
  }

  // Artifact hosts supply their own <!doctype>/<head>/<body>, so emit only the
  // page contents: <title>, the inlined <style>, the markup and the script.
  const target = args[artifactIndex + 1] || resolve(ROOT, 'artifact.html');
  const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Game';
  const body = out.slice(out.indexOf('<body>') + '<body>'.length, out.lastIndexOf('</body>'));
  const style = (out.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const fragment = `<title>${title}</title>\n${style}\n${body.trim()}\n`;
  await writeFile(target, fragment, 'utf8');
  console.log(`${target} written (${Math.round(Buffer.byteLength(fragment) / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
