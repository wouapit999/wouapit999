import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icons';

const UPCOMING: ReadonlyArray<{ title: string; body: string; phase: string; icon: IconName }> = [
  {
    title: 'KYC queue',
    body: 'Review identity documents and approve or reject customer verification.',
    phase: 'Phase 2',
    icon: 'users',
  },
  {
    title: 'Providers',
    body: 'Mobile-money and bank rail integrations, routing and failover.',
    phase: 'Phase 3',
    icon: 'activity',
  },
  {
    title: 'Transactions',
    body: 'Search, trace and replay remittances across corridors.',
    phase: 'Phase 4',
    icon: 'scroll',
  },
  {
    title: 'Treasury',
    body: 'Float balances, FX rates and liquidity alerts per currency.',
    phase: 'Phase 5',
    icon: 'key',
  },
  {
    title: 'Compliance',
    body: 'Sanctions screening, transaction monitoring and SAR workflows.',
    phase: 'Phase 6',
    icon: 'shield',
  },
];

/** Greyed placeholders for areas that later phases deliver. */
export function PhaseTiles() {
  return (
    <section aria-labelledby="upcoming-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="upcoming-heading" className="text-sm font-semibold text-fg">
          Coming in later phases
        </h2>
        <Badge tone="neutral">Phase 2+</Badge>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {UPCOMING.map((item) => (
          <li
            key={item.title}
            aria-disabled="true"
            className="rounded-card border border-dashed border-border bg-surface-muted/50 p-5 text-fg-subtle"
          >
            <div className="flex items-center justify-between gap-2">
              <Icon name={item.icon} className="h-5 w-5" />
              <Badge tone="neutral">{item.phase}</Badge>
            </div>
            <p className="mt-3 text-sm font-semibold text-fg-muted">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
