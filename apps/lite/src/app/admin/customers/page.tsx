import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { FilterBar } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  countryParam,
  enumOptions,
  enumParam,
  flattenParams,
  hrefWith,
  pageParam,
  textParam,
} from '@/components/admin/helpers';
import {
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
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
import { listCountries } from '@/server/countries';
import { STAFF_ROLES } from '@/server/rbac';
import { searchUsers } from '@/server/users';

export const metadata: Metadata = { title: 'Customers' };

const KYC_STATUSES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;

const querySchema = z.object({
  q: textParam,
  country: countryParam,
  kyc: enumParam(KYC_STATUSES),
  risk: enumParam(RISK_LEVELS),
  status: enumParam(USER_STATUSES),
  page: pageParam,
});

/** Customer search: name, e-mail or phone, narrowed by country, KYC status, risk and status. */
export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const [result, countries] = await Promise.all([
    searchUsers(ctx, {
      role: 'CUSTOMER',
      search: query.q,
      countryCode: query.country,
      kycStatus: query.kyc,
      riskLevel: query.risk,
      status: query.status,
      page: query.page,
      pageSize: 20,
    }),
    listCountries(),
  ]);
  const filters = {
    q: query.q,
    country: query.country,
    kyc: query.kyc,
    risk: query.risk,
    status: query.status,
  };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Search every customer account and open its 360° view: wallets, verification history, risk profile, transfers and audit trail."
      />
      <Card>
        <FilterBar action="/admin/customers">
          <Input
            name="q"
            type="search"
            label="Name, e-mail or phone"
            defaultValue={query.q}
            placeholder="amina, @example.com, +2376…"
          />
          <Select
            name="country"
            label="Country"
            placeholder="All countries"
            defaultValue={query.country}
            options={countries.map((country) => ({
              value: country.code,
              label: `${country.name} (${country.code})`,
            }))}
          />
          <Select
            name="kyc"
            label="KYC status"
            placeholder="Any KYC status"
            defaultValue={query.kyc}
            options={enumOptions(KYC_STATUSES, humanize)}
          />
          <Select
            name="risk"
            label="Risk level"
            placeholder="Any risk level"
            defaultValue={query.risk}
            options={enumOptions(RISK_LEVELS, humanize)}
          />
          <Select
            name="status"
            label="Account status"
            placeholder="Any status"
            defaultValue={query.status}
            options={enumOptions(USER_STATUSES, humanize)}
          />
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No customer matches these filters' : 'No customers yet'}
            description={
              filtered
                ? 'Try a shorter search or remove a filter.'
                : 'Customers appear here once they register.'
            }
          />
        ) : (
          <>
            <p className="px-5 pt-3 text-sm text-fg-muted sm:px-6" role="status">
              {result.total} customer{result.total === 1 ? '' : 's'}
              {filtered ? ' match' : ''}
            </p>
            <Table caption="Customers">
              <THead>
                <Tr>
                  <Th>Customer</Th>
                  <Th>Phone</Th>
                  <Th>Country</Th>
                  <Th>KYC</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                  <Th>Last sign-in</Th>
                  <Th>Joined</Th>
                </Tr>
              </THead>
              <TBody>
                {result.items.map((user) => (
                  <Tr key={user.id}>
                    <Td>
                      <Link
                        href={`/admin/customers/${user.id}`}
                        className="font-medium text-fg underline-offset-2 hover:underline"
                      >
                        {user.fullName}
                      </Link>
                      <p className="text-xs text-fg-subtle">{user.email}</p>
                    </Td>
                    <Td className="tabular whitespace-nowrap">{user.phone ?? '—'}</Td>
                    <Td>{user.countryCode ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={user.kycStatus} />{' '}
                      <span className="text-xs text-fg-muted">{humanize(user.kycTier)}</span>
                    </Td>
                    <Td>
                      <StatusBadge status={user.riskLevel} />{' '}
                      <span className="tabular text-xs text-fg-muted">{user.riskScore}</span>
                    </Td>
                    <Td>
                      <StatusBadge status={user.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatRelative(user.lastLoginAt)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(user.createdAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(page) => hrefWith('/admin/customers', { ...filters, page })}
            />
          </>
        )}
      </Card>
    </>
  );
}
