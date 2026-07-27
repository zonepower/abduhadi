#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Builds the voice-recording manifest: every spoken clause in the game, with
// its character and emotion, keyed exactly the way the dialogue director will
// look it up at runtime (`who|clauseText`).
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// must match #clauses() in src/engine/voice.js
const splitClauses = (text) => {
  const parts = text.split(/(?<=[.!؟?…،:])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [text];
};

const WHO_BY_HELPER = { K: 'karim', L: 'layla', S: 'shepherd', N: 'narrator' };
const DEFAULT_EMO = { K: 'calm', L: 'calm', S: 'cold', N: 'soft' };

async function main() {
  const story = await readFile(resolve(ROOT, 'src/game/story.js'), 'utf8');
  const game = await readFile(resolve(ROOT, 'src/game/game.js'), 'utf8');

  const lines = [];

  // K('text', 'emo') helper calls in story.js
  const helperRe = /\b([KLSN])\('([^']+)'(?:,\s*'([^']+)')?/g;
  let m;
  while ((m = helperRe.exec(story)) !== null) {
    lines.push({ who: WHO_BY_HELPER[m[1]], text: m[2], emo: m[3] || DEFAULT_EMO[m[1]] });
  }

  // { who: 'x', text: '...', emo: '...' } literals in game.js
  const objRe = /\{\s*who:\s*'(\w+)',\s*text:\s*'([^']+)'(?:,\s*emo:\s*'(\w+)')?/g;
  while ((m = objRe.exec(game)) !== null) {
    lines.push({ who: m[1], text: m[2], emo: m[3] || 'calm' });
  }

  // LAUGH_LINES — the villain's taunts, spoken after his laugh
  const laughBlock = story.match(/LAUGH_LINES = \[([\s\S]*?)\];/);
  if (laughBlock) {
    const strRe = /'([^']+)'/g;
    while ((m = strRe.exec(laughBlock[1])) !== null) {
      lines.push({ who: 'shepherd', text: m[1], emo: 'mock' });
    }
  }

  // dynamic valve counter lines — JS interpolates Western digits
  for (const n of [1, 2]) {
    lines.push({ who: 'karim', text: `صمام ${n} من ٣.`, emo: 'tense' });
  }

  // Emotions whose delivery interleaves sobs between clauses need one clip
  // per clause; everything else records the full line so the neural voice
  // keeps its natural sentence prosody.
  const BETWEEN = new Set(['cry', 'plead']);
  const clips = new Map();
  lines.forEach((line) => {
    const pieces = BETWEEN.has(line.emo) ? splitClauses(line.text) : [line.text];
    pieces.forEach((piece) => {
      const key = `${line.who}|${piece}`;
      if (!clips.has(key)) clips.set(key, { who: line.who, text: piece, emo: line.emo });
    });
  });

  const manifest = [...clips.values()];
  await writeFile(
    resolve(ROOT, 'tools/voice-manifest.json'),
    JSON.stringify(manifest, null, 1),
    'utf8'
  );
  const byWho = manifest.reduce((acc, c) => ((acc[c.who] = (acc[c.who] || 0) + 1), acc), {});
  console.log(`manifest: ${manifest.length} clips`, JSON.stringify(byWho));
}

main().catch((err) => { console.error(err); process.exit(1); });
