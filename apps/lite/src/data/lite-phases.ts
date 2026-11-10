import schedule from './roadmap-schedule.json';

/**
 * The programme schedule (copied from docs/roadmap/schedule.json by scripts/sync-roadmap.mjs)
 * joined with what BI-Rem Lite already implements for each phase. Rendered by /roadmap and the
 * landing page.
 */

export interface RoadmapPhase {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly weeks: number;
  readonly team: string;
  readonly dependsOn: readonly number[];
  /** What Lite ships today for this phase. */
  readonly lite: readonly string[];
  /** What stays on the roadmap (not in Lite). */
  readonly later: string;
}

const LITE: Readonly<Record<number, { lite: string[]; later: string }>> = {
  1: {
    lite: [
      'Registration, login and logout with scrypt hashing and lockout after 5 failures',
      'Six roles with a permission map, enforced server-side',
      'Append-only audit log on every mutation; in-app notifications',
      'Health endpoint and public status page',
    ],
    later: 'NestJS API, Redis queues, e-mail/SMS delivery, SSO.',
  },
  2: {
    lite: [
      'Customer profile, optional TOTP two-factor authentication',
      'KYC cases with document upload (≤ 1 MB, stored with a sha256)',
      'Simulated Veriff / Sumsub / Smile Identity behind one interface',
      'KYC tiers with limits, beneficiaries, risk profile, admin review queue',
    ],
    later: 'Live vendor integrations, liveness checks, document OCR.',
  },
  3: {
    lite: [
      'Provider directory in the database — no credential in code',
      'Encrypted credentials (AES-256-GCM), never shown after saving',
      'Secret rotation with versions; connectivity tests and health history',
    ],
    later: 'HSM / KMS-backed keys, mTLS, per-provider IP allow-lists.',
  },
  4: {
    lite: [
      'One WalletConnector interface: validate, balance, transfer, status, reverse, statement',
      'Deterministic simulator for MTN MoMo, Orange Money, Airtel Money, Moov Money, M-Pesa, Unitel Money, e-Mola',
      'Generic HTTP connector for production endpoints (not yet tested against real operators)',
      'Signed inbound webhooks with replay protection; idempotency keys',
    ],
    later: 'Certified operator adapters and sandbox onboarding with each operator.',
  },
  5: {
    lite: [
      'Wallet → wallet, wallet → merchant, wallet → agent',
      'Configurable fee rules (fixed + bps, minimum, cap)',
      'Double-entry ledger with row locks; limits per KYC tier',
      'History, tracking timeline, printable and PDF receipts',
    ],
    later: 'Bill payments, QR payments, scheduled transfers.',
  },
  6: {
    lite: [
      'Corridors between CEMAC, Angola, Mozambique, Cabo Verde, Guinea-Bissau and São Tomé',
      'Quotes with the FX rate locked for 15 minutes',
      'Cross-currency, cross-network execution; purpose and source of funds',
      'Reconciliation view',
    ],
    later: 'Bank payouts, cash pick-up networks, diaspora (EUR/USD) pay-in.',
  },
  7: {
    lite: [
      'FX table with mid rate, source and margin per pair; audited manual overrides',
      'Treasury dashboard: float per currency with low-liquidity alerts',
      'Profit analytics: fees and FX margin by day and corridor',
    ],
    later: 'Live rate feeds, hedging, automated rebalancing.',
  },
  8: {
    lite: [
      'Rule engine: amount, velocity, structuring, new-account, high-risk corridor',
      'Fuzzy sanctions / PEP screening on a fictional demo list',
      'Automatic hold of flagged transfers; alerts → cases → notes → release / reject',
      'SAR workflow: draft → filed with reference',
    ],
    later: 'Licensed sanctions data, goAML filing, machine-learning fraud scoring.',
  },
  9: {
    lite: [
      'Partner, merchant and agent onboarding (self-serve application or by an admin)',
      'Partner portal: commissions accrued per transfer, settlements',
      'API keys (shown once, stored hashed) and signed webhook deliveries',
      'Public REST API /api/v1 authenticated by API key',
    ],
    later: 'Sub-accounts, hosted checkout, SDKs.',
  },
  10: {
    lite: [
      'Executive, operational, revenue, compliance and treasury dashboards — live from Postgres',
      'KPIs: volume, value, revenue, failures, provider performance, country activity, FX profit, DAU/MAU',
      'Exports to CSV, Excel and PDF',
    ],
    later: 'Data warehouse, scheduled reports, regulator report packs.',
  },
  11: {
    lite: [
      'Mobile-first responsive interface',
      'Installable web app (manifest, icons, theme colour)',
    ],
    later: 'Native React Native apps for iOS and Android with biometrics and push notifications.',
  },
  12: {
    lite: [
      'Health endpoint with a database check; public status page',
      'Security headers: CSP, HSTS, frame-ancestors',
      'Database-backed rate limiting on authentication',
      'CI job and a one-page deploy guide for GitHub + Vercel + Neon',
    ],
    later: 'Multi-region infrastructure, penetration test, DR drills, 24/7 on-call.',
  },
  13: {
    lite: [
      'Country registry with an enabled flag — Nigeria, Ghana, Kenya, Uganda, Tanzania, Rwanda and South Africa are seeded as planned',
      'Rails registry listing Visa Direct, Mastercard Send, TerraPay, Onafriq, Flutterwave, Paystack, ISO 20022, SWIFT and SEPA as planned connectors',
    ],
    later: 'Licences, local partners and live connectors per new market.',
  },
};

export const ROADMAP = {
  program: schedule.program,
  programStart: schedule.programStart,
  phases: schedule.phases.map((phase): RoadmapPhase => ({
    ...phase,
    lite: LITE[phase.id]?.lite ?? [],
    later: LITE[phase.id]?.later ?? '',
  })),
} as const;

export type PhaseStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';

/** Status of a phase on a given day, from its schedule dates (inclusive, UTC). */
export function phaseStatus(
  phase: Pick<RoadmapPhase, 'start' | 'end'>,
  today: Date = new Date(),
): PhaseStatus {
  const day = today.toISOString().slice(0, 10);
  if (day < phase.start) return 'PLANNED';
  if (day > phase.end) return 'DONE';
  return 'IN_PROGRESS';
}
