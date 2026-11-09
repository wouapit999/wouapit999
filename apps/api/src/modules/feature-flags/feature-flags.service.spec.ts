import { describe, expect, it, jest } from '@jest/globals';
import type { FeatureFlag } from '@bi-rem/db';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { inRollout, rolloutBucket } from './rollout.js';

function flag(partial: Partial<FeatureFlag>): FeatureFlag {
  return {
    id: 'f1',
    key: 'portal.new-dashboard',
    enabled: true,
    rolloutPercentage: 100,
    rules: [],
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe('rollout bucketing', () => {
  it('is deterministic and bounded', () => {
    const a = rolloutBucket('k', 'user-1');
    expect(a).toBe(rolloutBucket('k', 'user-1'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
    expect(rolloutBucket('k', 'user-1')).not.toBe(
      rolloutBucket('other-key', 'user-1') === a ? -1 : rolloutBucket('other-key', 'user-1'),
    );
  });

  it('includes roughly the requested share of users', () => {
    const total = 20_000;
    let hits = 0;
    for (let i = 0; i < total; i += 1) if (inRollout('auth.mfa.totp', `user-${i}`, 30)) hits += 1;
    const share = hits / total;
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.33);
    expect(inRollout('x', 'u', 0)).toBe(false);
    expect(inRollout('x', 'u', 100)).toBe(true);
  });
});

describe('FeatureFlagsService.evaluate', () => {
  it('returns false when disabled regardless of rules', () => {
    expect(
      FeatureFlagsService.evaluate(
        flag({ enabled: false, rules: [{ attribute: 'realm', op: 'eq', value: 'ADMIN' }] }),
        { realm: 'ADMIN' },
      ),
    ).toBe(false);
  });

  it('applies targeting rules before rollout', () => {
    const f = flag({
      rolloutPercentage: 0,
      rules: [{ attribute: 'emailDomain', op: 'in', value: ['bi-rem.local'] }],
    });
    expect(FeatureFlagsService.evaluate(f, { userId: 'u', email: 'ops@bi-rem.local' })).toBe(true);
    expect(FeatureFlagsService.evaluate(f, { userId: 'u', email: 'x@gmail.com' })).toBe(false);
    const notIn = flag({
      rolloutPercentage: 0,
      rules: [{ attribute: 'countryCode', op: 'not_in', value: ['NG'] }],
    });
    expect(FeatureFlagsService.evaluate(notIn, { countryCode: 'SN' })).toBe(true);
    expect(FeatureFlagsService.evaluate(notIn, { countryCode: 'NG' })).toBe(false);
    expect(FeatureFlagsService.evaluate(notIn, {})).toBe(false);
  });

  it('buckets by user id for partial rollouts and excludes anonymous subjects', () => {
    const f = flag({ key: 'portal.new-dashboard', rolloutPercentage: 50 });
    expect(FeatureFlagsService.evaluate(f, {})).toBe(false);
    const on = FeatureFlagsService.evaluate(f, { userId: 'user-a' });
    expect(on).toBe(inRollout('portal.new-dashboard', 'user-a', 50));
  });
});

describe('FeatureFlagsService.isEnabled', () => {
  function service(row: FeatureFlag | null) {
    const findUnique = jest.fn(async () => row);
    const prisma = { client: { featureFlag: { findUnique } } } as unknown as PrismaService;
    return { service: new FeatureFlagsService(prisma), findUnique };
  }

  it('uses shared defaults when no row exists', async () => {
    const { service: s } = service(null);
    expect(await s.isEnabled('auth.registration.open')).toBe(true);
    expect(await s.isEnabled('notifications.sms')).toBe(false);
    expect(await s.isEnabled('unknown.flag')).toBe(false);
  });

  it('caches lookups for 30 seconds', async () => {
    const { service: s, findUnique } = service(flag({ key: 'k.a', rolloutPercentage: 100 }));
    let clock = 1_000_000;
    s.now = () => clock;
    expect(await s.isEnabled('k.a', { userId: 'u' })).toBe(true);
    expect(await s.isEnabled('k.a', { userId: 'u' })).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    clock += 31_000;
    await s.isEnabled('k.a', { userId: 'u' });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
