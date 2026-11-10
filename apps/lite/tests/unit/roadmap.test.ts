import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ROADMAP, phaseStatus } from '@/data/lite-phases';

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

describe('roadmap data', () => {
  it('covers the 13 phases, each with what Lite implements', () => {
    expect(ROADMAP.phases.map((phase) => phase.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    for (const phase of ROADMAP.phases) {
      expect(phase.lite.length, `phase ${phase.id}`).toBeGreaterThan(0);
      expect(phase.start <= phase.end).toBe(true);
    }
  });

  it('derives the status from the schedule dates', () => {
    const phase = { start: '2026-11-16', end: '2026-12-25' };
    expect(phaseStatus(phase, new Date('2026-11-15T23:59:59Z'))).toBe('PLANNED');
    expect(phaseStatus(phase, new Date('2026-11-16T00:00:00Z'))).toBe('IN_PROGRESS');
    expect(phaseStatus(phase, new Date('2026-12-25T23:00:00Z'))).toBe('IN_PROGRESS');
    expect(phaseStatus(phase, new Date('2026-12-26T00:00:00Z'))).toBe('DONE');
  });

  // The app carries copies of the roadmap so the Vercel build is self-contained. They must not
  // drift from docs/ — run `pnpm --filter @bi-rem/lite sync:roadmap` when this fails. The HTML
  // copy is adapted by the sync script (its ../phases links would 404 on the deployed site), so
  // the comparison is delegated to the script's own --check mode.
  const docsSchedule = path('../../../../docs/roadmap/schedule.json');
  it.skipIf(!existsSync(docsSchedule))(
    'copies match docs/roadmap (run scripts/sync-roadmap.mjs)',
    () => {
      expect(readFileSync(path('../../src/data/roadmap-schedule.json'), 'utf8')).toBe(
        readFileSync(docsSchedule, 'utf8'),
      );
      const result = spawnSync(
        process.execPath,
        [path('../../scripts/sync-roadmap.mjs'), '--check'],
        {
          encoding: 'utf8',
        },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
  );

  it('the full roadmap copy has no link that leaves the deployed site', () => {
    const html = readFileSync(path('../../public/roadmap-full.html'), 'utf8');
    expect(html).not.toContain('../phases/');
    expect(html).toContain('/roadmap#phase-${p.id}');
  });
});
