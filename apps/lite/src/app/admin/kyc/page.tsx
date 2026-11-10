import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  enumParam,
  flattenParams,
  hrefWith,
  pageParam,
} from '@/components/admin/helpers';
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SimulatedBadge,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDate, formatRelative, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listKycCases } from '@/server/kyc';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

export const metadata: Metadata = { title: 'KYC queue' };

const STATUSES = ['IN_REVIEW', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RESUBMIT_REQUESTED'] as const;
const querySchema = z.object({
  status: enumParam([...STATUSES, 'ALL']),
  page: pageParam,
});

/** Verification queue: cases the simulated vendor could not clear wait here for a human. */
export default async function KycQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { status = 'IN_REVIEW', page } = querySchema.parse(flattenParams(await searchParams));
  const [result, waiting] = await Promise.all([
    listKycCases(ctx, { status: status === 'ALL' ? undefined : status, page, pageSize: 20 }),
    listKycCases(ctx, { status: 'IN_REVIEW', pageSize: 1 }),
  ]);
  const canReview = roleHasPermission(user.role, 'kyc:review');

  return (
    <>
      <PageHeader
        title="KYC verification queue"
        description="Review the identity documents of cases the vendor flagged, then approve, reject or ask the customer to resubmit."
      />
      {!canReview ? (
        <Alert tone="info" className="mb-5">
          You can follow the queue, but only compliance officers and administrators can open
          documents and decide cases.
        </Alert>
      ) : null}
      <Tabs
        label="Case status"
        active={status}
        tabs={[
          { key: 'IN_REVIEW', label: 'To review', count: waiting.total },
          { key: 'APPROVED', label: 'Approved' },
          { key: 'REJECTED', label: 'Rejected' },
          { key: 'RESUBMIT_REQUESTED', label: 'Resubmission requested' },
          { key: 'ALL', label: 'All cases' },
        ].map((tab) => ({ ...tab, href: hrefWith('/admin/kyc', { status: tab.key }) }))}
      />
      <Card>
        {result.items.length === 0 ? (
          <EmptyState
            title={status === 'IN_REVIEW' ? 'The queue is empty' : 'No case with this status'}
            description={
              status === 'IN_REVIEW'
                ? 'Cases appear here when the vendor asks for a manual review.'
                : undefined
            }
          />
        ) : (
          <>
            <Table caption="KYC cases">
              <THead>
                <Tr>
                  <Th>Customer</Th>
                  <Th>Country</Th>
                  <Th>Target tier</Th>
                  <Th>ID</Th>
                  <Th>Vendor</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                  <Th>Submitted</Th>
                </Tr>
              </THead>
              <TBody>
                {result.items.map((kycCase) => (
                  <Tr key={kycCase.id}>
                    <Td>
                      <Link
                        href={`/admin/kyc/${kycCase.id}`}
                        className="font-medium text-fg underline-offset-2 hover:underline"
                      >
                        {kycCase.user.fullName}
                      </Link>
                      <p className="text-xs text-fg-subtle">{kycCase.user.email}</p>
                    </Td>
                    <Td>{kycCase.user.countryCode ?? '—'}</Td>
                    <Td>{humanize(kycCase.targetTier)}</Td>
                    <Td>
                      {humanize(kycCase.idType)}{' '}
                      <span className="text-xs text-fg-muted">({kycCase.idCountry})</span>
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        {humanize(kycCase.vendor)} <SimulatedBadge />
                      </span>
                      <p className="text-xs text-fg-muted">
                        {kycCase.vendorDecision ? humanize(kycCase.vendorDecision) : 'No decision'}
                        {kycCase.vendorScore === null ? '' : ` · score ${kycCase.vendorScore}`}
                      </p>
                    </Td>
                    <Td>
                      <StatusBadge status={kycCase.user.riskLevel} />
                    </Td>
                    <Td>
                      <StatusBadge status={kycCase.status} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(kycCase.submittedAt)}
                      <p className="text-xs text-fg-muted">{formatRelative(kycCase.submittedAt)}</p>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(next) => hrefWith('/admin/kyc', { status, page: next })}
            />
          </>
        )}
      </Card>
    </>
  );
}
