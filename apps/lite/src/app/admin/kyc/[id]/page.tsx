import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { type SearchParams, enumOptions, flattenParams } from '@/components/admin/helpers';
import { Notice } from '@/components/admin/notice';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  PageHeader,
  Select,
  SimulatedBadge,
  StatusBadge,
  SubmitButton,
  Textarea,
  buttonClasses,
} from '@/components/ui';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { KYC_TIER_INFO, getKycCase } from '@/server/kyc';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { assignTierAction } from '../../customers/actions';
import { reviewKycCaseAction } from '../actions';

export const metadata: Metadata = { title: 'KYC case' };

const vendorResultSchema = z.object({
  checks: z.array(z.object({ name: z.string(), detail: z.string(), passed: z.boolean() })),
});

const formatBytes = (size: number): string =>
  size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(size / 1024)} kB`;

/** One KYC case: applicant, vendor checks, documents (preview / download), decision, tier. */
export default async function KycCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx, user: viewer } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  const { notice } = flattenParams(await searchParams);
  if (!z.uuid().safeParse(id).success) notFound();
  const kycCase = await getKycCase(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const canReview = roleHasPermission(viewer.role, 'kyc:review');
  const open = kycCase.status === 'IN_REVIEW' || kycCase.status === 'SUBMITTED';
  const vendorResult = vendorResultSchema.safeParse(kycCase.vendorResult);
  const applicant = kycCase.user;

  return (
    <>
      <PageHeader
        back={{ href: '/admin/kyc', label: 'KYC queue' }}
        title={`KYC case — ${applicant.fullName}`}
        description={`Submitted ${formatDateTime(kycCase.submittedAt)} for ${KYC_TIER_INFO[kycCase.targetTier].label}`}
        actions={<StatusBadge status={kycCase.status} />}
      />
      <Notice code={notice} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Documents"
              description="Every view and download by staff is written to the audit log."
            />
            <CardBody>
              {!canReview ? (
                <Alert tone="info">
                  Documents can only be opened by compliance officers and administrators.
                </Alert>
              ) : kycCase.documents.length === 0 ? (
                <p className="text-sm text-fg-muted">No document is attached to this case.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {kycCase.documents.map((document) => {
                    const href = `/admin/kyc/documents/${document.id}`;
                    const isImage = document.mimeType.startsWith('image/');
                    return (
                      <li
                        key={document.id}
                        className="overflow-hidden rounded-lg border border-border"
                        data-document={document.kind}
                      >
                        {isImage ? (
                          // Authorised, audited route — not a static asset, so no next/image.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${href}?inline=1`}
                            alt={`${humanize(document.kind)} of ${applicant.fullName}`}
                            loading="lazy"
                            className="h-48 w-full bg-surface-muted object-contain"
                          />
                        ) : (
                          <div className="flex h-48 items-center justify-center bg-surface-muted px-4 text-center text-sm text-fg-muted">
                            {document.mimeType === 'application/pdf'
                              ? 'PDF document — download to read it.'
                              : 'No preview for this file type.'}
                          </div>
                        )}
                        <div className="space-y-2 px-3 py-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-fg">{humanize(document.kind)}</span>
                            <Badge>{formatBytes(document.size)}</Badge>
                          </div>
                          <p className="truncate text-xs text-fg-muted" title={document.fileName}>
                            {document.fileName} · {document.mimeType}
                          </p>
                          <p className="truncate font-mono text-[0.6875rem] text-fg-subtle">
                            sha256 {document.sha256}
                          </p>
                          <a
                            href={href}
                            download
                            className={buttonClasses('secondary', 'sm')}
                            data-download={document.kind}
                          >
                            Download
                            <span className="sr-only"> {humanize(document.kind)}</span>
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Vendor verification"
              description="The KYC vendor is simulated: no real identity check was performed."
              action={<SimulatedBadge />}
            />
            <CardBody className="space-y-4">
              <DescriptionList
                items={[
                  { label: 'Vendor', value: humanize(kycCase.vendor) },
                  { label: 'Vendor reference', value: kycCase.vendorRef ?? '—' },
                  {
                    label: 'Decision',
                    value: kycCase.vendorDecision ? humanize(kycCase.vendorDecision) : '—',
                  },
                  { label: 'Score', value: kycCase.vendorScore ?? '—' },
                ]}
              />
              {vendorResult.success ? (
                <ul className="space-y-1.5 text-sm">
                  {vendorResult.data.checks.map((check) => (
                    <li key={check.name} className="flex items-start gap-2">
                      <Badge tone={check.passed ? 'success' : 'danger'}>
                        {check.passed ? 'Passed' : 'Failed'}
                      </Badge>
                      <span>
                        <span className="font-medium text-fg">{humanize(check.name)}</span>
                        <span className="text-fg-muted"> — {check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          {kycCase.reviewNote ? (
            <Card>
              <CardHeader
                title="Decision"
                description={`Decided ${formatDateTime(kycCase.decidedAt)}`}
              />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm text-fg">{kycCase.reviewNote}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Applicant"
              action={
                <Link
                  href={`/admin/customers/${applicant.id}`}
                  className="text-sm font-medium text-accent underline"
                >
                  Customer 360°
                </Link>
              }
            />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Name', value: applicant.fullName },
                  { label: 'E-mail', value: applicant.email },
                  { label: 'Phone', value: applicant.phone ?? '—' },
                  { label: 'Country', value: applicant.countryCode ?? '—' },
                  { label: 'Date of birth', value: formatDate(applicant.dateOfBirth) },
                  { label: 'Current tier', value: KYC_TIER_INFO[applicant.kycTier].label },
                  { label: 'KYC status', value: <StatusBadge status={applicant.kycStatus} /> },
                  {
                    label: 'Risk',
                    value: (
                      <>
                        <StatusBadge status={applicant.riskLevel} />{' '}
                        <span className="tabular text-xs text-fg-muted">
                          score {applicant.riskScore}
                        </span>
                      </>
                    ),
                  },
                  { label: 'ID type', value: humanize(kycCase.idType) },
                  { label: 'ID number', value: kycCase.idNumber },
                  { label: 'Issued by', value: kycCase.idCountry },
                ]}
              />
            </CardBody>
          </Card>

          {canReview && open ? (
            <Card>
              <CardHeader
                title="Decide this case"
                description={`Approving raises the customer to ${KYC_TIER_INFO[kycCase.targetTier].label}.`}
              />
              <CardBody>
                <ActionForm action={reviewKycCaseAction} className="space-y-3">
                  <input type="hidden" name="caseId" value={kycCase.id} />
                  <Select
                    name="decision"
                    label="Decision"
                    required
                    placeholder="Choose…"
                    options={[
                      { value: 'APPROVE', label: 'Approve' },
                      { value: 'REJECT', label: 'Reject' },
                      { value: 'RESUBMIT', label: 'Ask to resubmit' },
                    ]}
                  />
                  <Textarea
                    name="note"
                    label="Reason"
                    hint="Rejections and resubmission requests are shown to the customer."
                    rows={3}
                    required
                    minLength={3}
                  />
                  <FormMessage />
                  <SubmitButton pendingLabel="Saving…">Record decision</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {canReview ? (
            <Card>
              <CardHeader
                title="Assign tier"
                description="Set the customer's tier directly, independent of this case. Audited."
              />
              <CardBody>
                <ActionForm action={assignTierAction} className="space-y-3">
                  <input type="hidden" name="userId" value={applicant.id} />
                  <Select
                    name="tier"
                    label="Tier"
                    required
                    defaultValue={applicant.kycTier}
                    options={enumOptions(
                      ['TIER_0', 'TIER_1', 'TIER_2'],
                      (tier) => KYC_TIER_INFO[tier as keyof typeof KYC_TIER_INFO].label,
                    )}
                  />
                  <Textarea name="reason" label="Reason" rows={2} required minLength={5} />
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Assign tier
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
