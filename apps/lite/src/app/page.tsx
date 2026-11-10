import Link from 'next/link';

import { PublicShell } from '@/components/shell/public-shell';
import { Badge, Card, LinkButton } from '@/components/ui';
import { ROADMAP } from '@/data/lite-phases';
import { formatDate } from '@/lib/format';

/** Public landing page: what BI-Rem Lite is, what it covers, and where the roadmap lives. */

const HIGHLIGHTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Real money movement, in miniature',
    body: 'Wallets backed by a double-entry ledger: every transfer is one database transaction, every journal balances, and no wallet can go negative.',
  },
  {
    title: 'Domestic and international',
    body: 'Wallet to wallet, merchant and agent payments, and cross-border corridors between CEMAC, Angola, Mozambique, Cabo Verde, Guinea-Bissau and São Tomé with locked FX quotes.',
  },
  {
    title: 'Compliance built in',
    body: 'KYC tiers with limits, sanctions and PEP screening, an AML rule engine that holds suspicious transfers, cases, and a SAR workflow.',
  },
  {
    title: 'One connector interface',
    body: 'MTN MoMo, Orange Money, Airtel Money, Moov Money, M-Pesa, Unitel Money and e-Mola sit behind the same contract. In Lite they are simulated — adding a real operator is one database row.',
  },
  {
    title: 'Partners and an API',
    body: 'Merchants, agents and API partners get a portal, commissions, settlements, API keys, signed webhooks and a public REST API.',
  },
  {
    title: 'Dashboards and exports',
    body: 'Executive, operational, revenue, compliance and treasury dashboards computed live, with CSV, Excel and PDF exports.',
  },
];

const AREAS: ReadonlyArray<{ title: string; body: string; href: string; cta: string }> = [
  {
    title: 'Customers',
    body: 'Open a wallet, top up from mobile money, send at home or abroad, track every transfer and download receipts.',
    href: '/register',
    cta: 'Create an account',
  },
  {
    title: 'Back office',
    body: 'Customer 360°, KYC queue, AML cases, providers and credentials, fees, FX, treasury, reports and the audit log.',
    href: '/login',
    cta: 'Staff sign-in',
  },
  {
    title: 'Partners, merchants and agents',
    body: 'Apply online, get paid by code, earn commissions, integrate with API keys and webhooks.',
    href: '/partners/apply',
    cta: 'Become a partner',
  },
];

export default function LandingPage() {
  const first = ROADMAP.phases[0];
  const last = ROADMAP.phases[ROADMAP.phases.length - 1];
  return (
    <PublicShell>
      <section className="border-b border-border bg-gradient-to-b from-accent-soft to-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <Badge tone="gold">Demonstration platform — simulated operators, no real funds</Badge>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-fg sm:text-5xl">
            The whole BI-Rem programme, running today in one small app.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-fg-muted sm:text-lg">
            BI-Rem is a pan-African remittance and mobile-money platform built in 13 phases. BI-Rem
            Lite reflects every one of them end to end — with real authentication, a real database
            and real double-entry money movement — and deploys with nothing but GitHub, Vercel and
            Neon.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton href="/register" size="lg">
              Create an account
            </LinkButton>
            <LinkButton href="/login" size="lg" variant="secondary">
              Sign in
            </LinkButton>
            <LinkButton href="/roadmap" size="lg" variant="ghost">
              See the roadmap →
            </LinkButton>
          </div>
        </div>
      </section>

      <section aria-labelledby="highlights" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 id="highlights" className="text-xl font-semibold tracking-tight sm:text-2xl">
          What is inside
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title}>
              <Card padded className="h-full">
                <h3 className="font-semibold text-fg">{item.title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{item.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="areas" className="border-y border-border bg-surface-muted">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 id="areas" className="text-xl font-semibold tracking-tight sm:text-2xl">
            Three ways in
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {AREAS.map((area) => (
              <li key={area.title}>
                <Card padded className="flex h-full flex-col">
                  <h3 className="font-semibold text-fg">{area.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm text-fg-muted">{area.body}</p>
                  <Link
                    href={area.href}
                    className="mt-4 text-sm font-medium text-accent hover:underline"
                  >
                    {area.cta} →
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="roadmap" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="roadmap" className="text-xl font-semibold tracking-tight sm:text-2xl">
              The roadmap stays the plan
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Lite does not replace the programme: the full platform is still delivered in{' '}
              {ROADMAP.phases.length} phases
              {first && last ? `, from ${formatDate(first.start)} to ${formatDate(last.end)}` : ''}.
              Each phase below already has a working counterpart in Lite.
            </p>
          </div>
          <LinkButton href="/roadmap" variant="secondary">
            Phase by phase
          </LinkButton>
        </div>
        <ol className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.phases.map((phase) => (
            <li
              key={phase.id}
              className="flex items-baseline gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
            >
              <span className="tabular w-6 shrink-0 text-right font-semibold text-accent">
                {phase.id}
              </span>
              <span className="text-fg">{phase.name}</span>
            </li>
          ))}
        </ol>
      </section>
    </PublicShell>
  );
}
