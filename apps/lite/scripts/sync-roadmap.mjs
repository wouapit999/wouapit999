#!/usr/bin/env node
/**
 * Copies the programme roadmap from docs/ into the Lite app so that the Vercel build (root
 * directory apps/lite) never needs a file outside apps/lite:
 *
 *   docs/roadmap/schedule.json → apps/lite/src/data/roadmap-schedule.json   (rendered by /roadmap)
 *   docs/roadmap/index.html    → apps/lite/public/roadmap-full.html         (served as a static file)
 *
 * The HTML copy is adapted on the way: the interactive roadmap links every phase to
 * `../phases/phase-NN-<key>.md`, which exists in the repository but not on the deployed site, so
 * those links are pointed at the phase on the app's own /roadmap page instead.
 *
 *   node scripts/sync-roadmap.mjs           write the copies (runs before every build)
 *   node scripts/sync-roadmap.mjs --check   exit 1 when the committed copies are out of date
 *
 * The copies are committed. When docs/ is not present (a checkout of apps/lite alone) the script
 * keeps them and exits 0, so a build can never fail for lack of the sources.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const docs = resolve(app, '../../docs/roadmap');
const check = process.argv.includes('--check');

const PHASE_HREF = '../phases/phase-${pad2(p.id)}-${p.key}.md';
const PHASE_LABEL =
  'Open phase plan <span class="hint">phase-${pad2(p.id)}-${esc(p.key)}.md</span>';

/** Points the per-phase document links of the interactive roadmap at /roadmap#phase-<id>. */
export function adaptRoadmapHtml(html) {
  if (!html.includes(PHASE_HREF)) {
    throw new Error(
      'docs/roadmap/index.html no longer builds its phase links the expected way — update scripts/sync-roadmap.mjs',
    );
  }
  const adapted = html
    .replaceAll(PHASE_HREF, '/roadmap#phase-${p.id}')
    .replaceAll(
      PHASE_LABEL,
      'Open this phase in BI-Rem Lite <span class="hint">/roadmap#phase-${p.id}</span>',
    );
  if (adapted.includes('../phases/')) {
    throw new Error('a ../phases/ link is left in the roadmap copy and would 404 once deployed');
  }
  return adapted;
}

const identity = (text) => text;
const copies = [
  { from: 'schedule.json', to: 'src/data/roadmap-schedule.json', adapt: identity },
  { from: 'index.html', to: 'public/roadmap-full.html', adapt: adaptRoadmapHtml },
];

function main() {
  if (!existsSync(docs)) {
    console.log('sync-roadmap: docs/roadmap not found — keeping the committed copies');
    return 0;
  }
  let stale = 0;
  let written = 0;
  for (const copy of copies) {
    const source = resolve(docs, copy.from);
    const target = resolve(app, copy.to);
    if (!existsSync(source)) {
      console.error(`sync-roadmap: missing ${relative(app, source)}`);
      return 1;
    }
    const wanted = copy.adapt(readFileSync(source, 'utf8'));
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === wanted) continue;
    if (check) {
      stale += 1;
      console.error(`sync-roadmap: ${copy.to} is out of date — run "pnpm sync:roadmap"`);
    } else {
      writeFileSync(target, wanted);
      written += 1;
      console.log(`sync-roadmap: wrote ${copy.to}`);
    }
  }
  if (stale === 0 && written === 0) console.log('sync-roadmap: copies are up to date');
  return stale > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`sync-roadmap: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
