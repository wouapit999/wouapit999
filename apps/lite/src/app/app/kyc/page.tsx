import type { Metadata } from 'next';
import { z } from 'zod';

import { KycForm } from '@/components/customer/kyc-form';
import { LimitsSummary } from '@/components/customer/limits-card';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Money,
  PageHeader,
  SimulatedBadge,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import {
  KYC_ID_TYPES,
  KYC_TIER_INFO,
  MAX_DOCUMENT_BYTES,
  getLimitOverview,
  listMyKycCases,
  selectKycVendor,
} from '@/server/kyc';
import { getSetting } from '@/server/settings';

import {
  KYC_CASE_STATUS_LABELS,
  KYC_DOCUMENT_LABELS,
  KYC_ID_TYPE_LABELS,
  KYC_TIER_SHORT,
  KYC_VENDOR_LABELS,
  labelFor,
  optionsFor,
} from '../_lib/labels';
import { type SearchParams, readSearchParams } from '../_lib/page';

export const metadata: Metadata = { title: 'Verification' };

const TIERS = ['TIER_0', 'TIER_1', 'TIER_2'] as const;

const vendorResultSchema = z.object({
  checks: z
    .array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string().optional() }))
    .catch([]),
});

const RESULT_ALERTS: Readonly<
  Record<string, { tone: 'success' | 'info' | 'warning'; title: string; body: string }>
> = {
  APPROVED: {
    tone: 'success',
    title: 'Identity verified',
    body: 'Your documents passed the (simulated) vendor check and your limits have been raised.',
  },
  IN_REVIEW: {
    tone: 'info',
    title: 'Documents received',
    body: 'The (simulated) vendor asked for a manual review. Our compliance team will decide and you will be notified.',
  },
  REJECTED: {
    tone: 'warning',
    title: 'Verification unsuccessful',
    body: 'The (simulated) vendor could not verify your document. Check the details below and submit again.',
  },
};

const maskIdNumber = (value: string): string =>
  value.length <= 4 ? value : `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} kB`;

/** Identity verification: current tier and limits, submission form, history of cases. */
export default async function KycPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext('CUSTOMER');
  const query = await readSearchParams(searchParams);
  const [cases, limits, countries, defaultVendor] = await Promise.all([
    listMyKycCases(ctx),
    getLimitOverview(ctx),
    listCountries(),
    getSetting('kyc.defaultVendor'),
  ]);

  const latest = cases[0];
  const openCase = cases.find((item) => item.status === 'SUBMITTED' || item.status === 'IN_REVIEW');
  const upgradeTiers = TIERS.filter(
    (tier) => tier !== 'TIER_0' && TIERS.indexOf(tier) > TIERS.indexOf(user.kycTier),
  );
  const canSubmit = !openCase && upgradeTiers.length > 0;
  const resubmitting =
    canSubmit && (latest?.status === 'REJECTED' || latest?.status === 'RESUBMIT_REQUESTED');

  // Same routing function as the service, evaluated for every choice the form offers.
  const routing = Object.fromEntries(
    KYC_ID_TYPES.map((idType) => [
      idType,
      Object.fromEntries(
        countries.map((country) => [
          country.code,
          labelFor(KYC_VENDOR_LABELS, selectKycVendor(idType, country.code, defaultVendor)),
        ]),
      ),
    ]),
  );
  const resultAlert = query.result ? RESULT_ALERTS[query.result] : undefined;

  return (
    <>
      <PageHeader
        title="Identity verification"
        description="Verify your identity to raise your limits and unlock international transfers."
      />

      {resultAlert ? (
        <Alert tone={resultAlert.tone} title={resultAlert.title} className="mb-4">
          {resultAlert.body}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
        <div className="space-y-4 lg:col-span-3 lg:space-y-6">
          <Card>
            <CardHeader
              title={
                resubmitting
                  ? 'Submit your documents again'
                  : canSubmit
                    ? 'Submit your documents'
                    : 'Verification status'
              }
              action={<SimulatedBadge />}
            />
            <CardBody className="space-y-4">
              {resubmitting ? (
                <Alert
                  tone="warning"
                  title={
                    latest.status === 'RESUBMIT_REQUESTED'
                      ? 'We need better documents'
                      : 'Your last submission was not accepted'
                  }
                >
                  {latest.reviewNote ??
                    'Please check that the document is valid, readable and not cropped.'}
                </Alert>
              ) : null}

              {canSubmit ? (
                <KycForm
                  tiers={upgradeTiers.map((tier) => ({
                    value: tier,
                    label: KYC_TIER_INFO[tier].label,
                    requires: `Requires: ${KYC_TIER_INFO[tier].requires}`,
                  }))}
                  idTypes={optionsFor(KYC_ID_TYPES, KYC_ID_TYPE_LABELS)}
                  countries={countries
                    .map((country) => ({ value: country.code, label: country.name }))
                    .sort((a, b) => a.label.localeCompare(b.label))}
                  defaultCountry={user.countryCode ?? undefined}
                  routing={routing}
                  maxBytes={MAX_DOCUMENT_BYTES}
                  submitLabel={resubmitting ? 'Submit again' : 'Submit for verification'}
                />
              ) : openCase ? (
                <Alert tone="info" title="Your documents are being reviewed">
                  Submitted {formatDateTime(openCase.submittedAt)} for{' '}
                  {labelFor(KYC_TIER_SHORT, openCase.targetTier)}. You will get a notification as
                  soon as a decision is made — there is nothing more to do for now.
                </Alert>
              ) : (
                <Alert tone="success" title="You are fully verified">
                  You hold the highest verification level. No further documents are needed.
                </Alert>
              )}

              {canSubmit ? (
                <details className="rounded-lg border border-border px-4 py-3 text-sm">
                  <summary className="cursor-pointer font-medium text-fg">
                    Sandbox: how the simulated decision is made
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
                    <li>
                      Document number ending in <span className="font-mono">0000</span> → rejected
                    </li>
                    <li>
                      Ending in <span className="font-mono">9999</span>, or containing{' '}
                      <span className="font-mono">REVIEW</span> → sent to manual review
                    </li>
                    <li>Anything else → approved automatically</li>
                  </ul>
                </details>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Every submission and what happened to it." />
            {cases.length === 0 ? (
              <EmptyState
                title="No submission yet"
                description="Your verification requests and their status will appear here."
              />
            ) : (
              <ol aria-label="Verification history" className="divide-y divide-border">
                {cases.map((item) => {
                  const checks = vendorResultSchema.safeParse(item.vendorResult);
                  return (
                    <li key={item.id} className="space-y-3 px-5 py-4 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-fg">
                          {labelFor(KYC_TIER_SHORT, item.targetTier)} ·{' '}
                          {labelFor(KYC_ID_TYPE_LABELS, item.idType)}{' '}
                          <span className="font-mono font-normal text-fg-muted">
                            {maskIdNumber(item.idNumber)}
                          </span>{' '}
                          <span className="font-normal text-fg-muted">({item.idCountry})</span>
                        </p>
                        <StatusBadge
                          status={item.status}
                          label={labelFor(KYC_CASE_STATUS_LABELS, item.status)}
                        />
                      </div>

                      <ol className="space-y-2 border-l-2 border-border pl-4 text-sm">
                        <li>
                          <p className="font-medium text-fg">Documents submitted</p>
                          <p className="text-xs text-fg-muted">
                            {formatDateTime(item.submittedAt)}
                          </p>
                        </li>
                        <li>
                          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                            Vendor check — {labelFor(KYC_VENDOR_LABELS, item.vendor)}
                            <SimulatedBadge />
                          </p>
                          <p className="text-xs text-fg-muted">
                            {item.vendorDecision
                              ? `Decision: ${item.vendorDecision.toLowerCase()}${item.vendorScore === null ? '' : ` · score ${item.vendorScore}/100`}`
                              : 'Waiting for the vendor'}
                          </p>
                          {checks.success && checks.data.checks.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                              {checks.data.checks.map((check) => (
                                <li key={check.name}>
                                  <span className={check.passed ? 'text-success' : 'text-danger'}>
                                    {check.passed ? '✓ Passed' : '✗ Failed'}
                                  </span>{' '}
                                  — {check.detail ?? check.name}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                        <li>
                          <p className="font-medium text-fg">
                            {item.decidedAt
                              ? labelFor(KYC_CASE_STATUS_LABELS, item.status)
                              : 'Awaiting a decision from compliance'}
                          </p>
                          {item.decidedAt ? (
                            <p className="text-xs text-fg-muted">
                              {formatDateTime(item.decidedAt)}
                            </p>
                          ) : null}
                          {item.reviewNote ? (
                            <p className="mt-0.5 text-sm text-fg-muted">“{item.reviewNote}”</p>
                          ) : null}
                        </li>
                      </ol>

                      {item.documents.length > 0 ? (
                        <ul className="flex flex-wrap gap-2 text-xs">
                          {item.documents.map((document) => (
                            <li key={document.id}>
                              <a
                                href={`/app/kyc/documents/${document.id}`}
                                download
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
                              >
                                <span aria-hidden="true">↓</span>
                                {labelFor(KYC_DOCUMENT_LABELS, document.kind)}
                                <span className="text-fg-subtle">
                                  ({formatBytes(document.size)})
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          <Card>
            <CardHeader
              title="Your level"
              action={
                <StatusBadge
                  status={user.kycStatus}
                  label={
                    user.kycStatus === 'NONE'
                      ? 'Not verified'
                      : user.kycStatus === 'PENDING'
                        ? 'In review'
                        : undefined
                  }
                />
              }
            />
            <CardBody>
              <p className="text-base font-semibold text-fg">{KYC_TIER_INFO[user.kycTier].label}</p>
              <p className="mb-4 text-sm text-fg-muted">
                {KYC_TIER_INFO[user.kycTier].description}
              </p>
              <LimitsSummary
                tier={limits.tier}
                international={limits.limits.international}
                currency={limits.currency}
                local={limits.local}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Levels and limits" description="Limits are set in US dollars." />
            <ul
              aria-label="Transfer limits per verification level"
              className="divide-y divide-border"
            >
              {TIERS.map((tier) => {
                const tierLimits = limits.allTiers[tier];
                return (
                  <li key={tier} className="px-5 py-3.5 sm:px-6">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">
                      {labelFor(KYC_TIER_SHORT, tier)}
                      {tier === user.kycTier ? <Badge tone="brand">Yours</Badge> : null}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {KYC_TIER_INFO[tier].requires}
                      {tierLimits.international ? ' · international' : ' · domestic only'}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {(
                        [
                          ['Per transfer', tierLimits.perTransaction],
                          ['Per day', tierLimits.daily],
                          ['Per month', tierLimits.monthly],
                        ] as const
                      ).map(([label, amount]) => (
                        <div key={label}>
                          <dt className="text-fg-subtle">{label}</dt>
                          <dd className="mt-0.5 text-sm font-medium text-fg">
                            <Money amount={amount} currency="USD" />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
