#!/usr/bin/env node
/**
 * BI-Rem documentation checker.
 *
 * Validates the planning documentation under docs/:
 *   1. every ```mermaid block renders with @mermaid-js/mermaid-cli (falls back to a
 *      syntax sanity pass when the CLI/browser is unavailable, and says so);
 *   2. every relative Markdown link resolves to an existing file;
 *   3. every phase document carries the start/end dates from docs/roadmap/schedule.json;
 *   4. every phase document has the 15 required H2 sections.
 *
 * Usage: node docs/roadmap/tools/check-docs.mjs [--no-mermaid] [--only <glob-substring>]
 * Exit code 1 on any failure.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const docsRoot = join(repoRoot, 'docs');
const args = process.argv.slice(2);
const noMermaid = args.includes('--no-mermaid');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const REQUIRED_SECTIONS = [
  'Overview',
  'Milestones',
  'Deliverables',
  'Architecture',
  'Data Model & Migrations',
  'API & Integration Surface',
  'Portal Changes',
  'Security & Compliance',
  'Test Plan',
  'CI/CD Pipeline',
  'Production Readiness Checklist',
  'Success Criteria Verification',
  'Risks & Mitigations',
  'Effort & Cost Drivers',
  'Dependencies & Handover',
];

const failures = [];
const stats = { files: 0, mermaidBlocks: 0, links: 0, dates: 0, sections: 0 };
const fail = (file, msg) => failures.push(`${relative(repoRoot, file)}: ${msg}`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(p, out);
    } else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const mdFiles = [...walk(docsRoot), join(repoRoot, 'README.md')].filter(
  (f) => existsSync(f) && (!only || f.includes(only)),
);

// ---------------------------------------------------------------- mermaid
function findMermaidCli() {
  const local = join(repoRoot, 'node_modules', '.bin', 'mmdc');
  if (existsSync(local)) return [local];
  return ['npx', '-y', '-p', '@mermaid-js/mermaid-cli', 'mmdc'];
}

function puppeteerConfigPath() {
  const candidates = ['/opt/pw-browsers/chromium', process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  const exe = candidates.find((c) => existsSync(c));
  const cfg = { args: ['--no-sandbox', '--disable-gpu'] };
  if (exe) cfg.executablePath = exe;
  const dir = mkdtemp();
  const p = join(dir, 'puppeteer.json');
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

function mkdtemp() {
  const dir = join(tmpdir(), `birem-docs-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function syntaxSanity(code) {
  const problems = [];
  const first = code.trim().split('\n')[0]?.trim() ?? '';
  if (!/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|C4Context|C4Container|C4Component|C4Deployment|xychart-beta|block-beta|sankey-beta|%%\{init)/.test(first)) {
    problems.push(`unknown diagram type "${first.slice(0, 40)}"`);
  }
  const open = (code.match(/\[/g) ?? []).length;
  const close = (code.match(/\]/g) ?? []).length;
  if (open !== close) problems.push(`unbalanced square brackets (${open} vs ${close})`);
  if (/^gantt/m.test(code) && /%/.test(code.replace(/%%.*$/gm, ''))) problems.push('gantt label contains "%"');
  return problems;
}

let mermaidMode = 'cli';
let mermaidCli = null;
let puppeteerCfg = null;

function validateMermaid(code, file, idx) {
  stats.mermaidBlocks += 1;
  if (noMermaid) return;
  if (mermaidMode === 'cli') {
    mermaidCli ??= findMermaidCli();
    puppeteerCfg ??= puppeteerConfigPath();
    const dir = mkdtemp();
    const input = join(dir, `block-${idx}.mmd`);
    const output = join(dir, `block-${idx}.svg`);
    writeFileSync(input, code);
    const res = spawnSync(mermaidCli[0], [...mermaidCli.slice(1), '-i', input, '-o', output, '-p', puppeteerCfg, '-q'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1' },
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    if (res.error || /command not found|Could not find|Failed to launch|ENOENT|not installed/i.test(out) && !existsSync(output)) {
      mermaidMode = 'sanity';
      console.warn(`! mermaid-cli unavailable (${(res.error?.message ?? out).trim().split('\n')[0]}); falling back to syntax sanity checks`);
    } else {
      rmSync(dir, { recursive: true, force: true });
      if (res.status !== 0 || !existsSync(output) && res.status !== 0) {
        const msg = out.split('\n').filter((l) => /error|Parse|Expecting|Syntax/i.test(l)).slice(0, 3).join(' | ') || out.trim().slice(0, 300);
        fail(file, `mermaid block #${idx} failed to render: ${msg}`);
      }
      return;
    }
  }
  for (const p of syntaxSanity(code)) fail(file, `mermaid block #${idx}: ${p}`);
}

// ----------------------------------------------------------------- links
function checkLinks(file, text) {
  const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(text))) {
    let target = m[1];
    if (/^(https?:|mailto:|#|tel:)/.test(target)) continue;
    stats.links += 1;
    target = target.split('#')[0];
    if (!target) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved)) fail(file, `broken link -> ${m[1]}`);
  }
}

// ----------------------------------------------------------------- phases
const schedule = JSON.parse(readFileSync(join(docsRoot, 'roadmap', 'schedule.json'), 'utf8'));

function checkPhaseDoc(file, text) {
  const match = /phase-(\d{2})-([a-z0-9-]+)\.md$/.exec(file);
  if (!match) return;
  const id = Number(match[1]);
  const phase = schedule.phases.find((p) => p.id === id);
  if (!phase) return fail(file, `no phase ${id} in schedule.json`);
  if (phase.key !== match[2]) fail(file, `file key "${match[2]}" differs from schedule key "${phase.key}"`);
  stats.dates += 2;
  if (!text.includes(phase.start)) fail(file, `start date ${phase.start} not found`);
  if (!text.includes(phase.end)) fail(file, `end date ${phase.end} not found`);
  // any ISO dates in the Milestones section must fall inside the phase window
  // dates on milestone table rows (| **M1.2** | ... ) must fall inside the phase window;
  // other dates in the section may legitimately reference neighbouring phases.
  const section = text.split(/^## /m).find((s) => /^\d+\.\s*Milestones/.test(s));
  if (section) {
    for (const line of section.split('\n')) {
      if (!/^\|\s*\**M\d+\.\d+\**\s*\|/.test(line)) continue;
      // the first ISO date on the row is the milestone's target date; later ones are prose references
      const d = (line.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? [])[0];
      if (d && (d < phase.start || d > phase.end)) fail(file, `milestone date ${d} outside phase window ${phase.start}..${phase.end}`);
    }
  }
  const h2 = [...text.matchAll(/^## \d+\.\s*(.+?)\s*$/gm)].map((m) => m[1]);
  for (const s of REQUIRED_SECTIONS) {
    stats.sections += 1;
    if (!h2.some((h) => h.toLowerCase() === s.toLowerCase())) fail(file, `missing section "## N. ${s}"`);
  }
}

// ------------------------------------------------------------------- run
for (const file of mdFiles) {
  stats.files += 1;
  const text = readFileSync(file, 'utf8');
  checkLinks(file, text);
  checkPhaseDoc(file, text);
  const blocks = [...text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  blocks.forEach((b, i) => validateMermaid(b[1], file, i + 1));
}

console.log(
  `checked ${stats.files} files · ${stats.mermaidBlocks} mermaid blocks (${noMermaid ? 'skipped' : mermaidMode}) · ${stats.links} links · ${stats.dates} dates · ${stats.sections} sections`,
);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('docs OK');
