import type { Metadata } from 'next';

import { HealthCard } from '@/components/dashboard/health-card';
import { PhaseTiles } from '@/components/dashboard/phase-tiles';
import { StatTiles } from '@/components/dashboard/stat-tiles';
import { PageHeader } from '@/components/ui/page-header';
import { publicEnv } from '@/env';
import { probeHealth } from '@/lib/server/health';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const probe = await probeHealth();
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`Overview of the ${publicEnv.NEXT_PUBLIC_ENV} environment. Counts come live from the Phase 1 API.`}
      />
      <HealthCard probe={probe} />
      <StatTiles />
      <PhaseTiles />
    </div>
  );
}
