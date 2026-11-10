import type { Metadata } from 'next';
import Link from 'next/link';

import { ActionButton } from '@/components/admin/action-button';
import { RailsRegistry } from '@/components/admin/rails-registry';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardHeader,
  FormMessage,
  PageHeader,
  Select,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listProviders } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { setCountryEnabledAction, setCountryRiskAction } from './actions';

export const metadata: Metadata = { title: 'Countries' };

/** Country registry (phase 13): live markets and the planned expansion countries. */
export default async function CountriesPage() {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const [countries, providers] = await Promise.all([listCountries(), listProviders(ctx)]);
  const canWrite = roleHasPermission(user.role, 'countries:write');
  const live = countries.filter((country) => country.enabled).length;
  const groups = [
    {
      key: 'core',
      title: 'Launch markets',
      description:
        'CEMAC, Angola, Mozambique, Cabo Verde, Guinea-Bissau and São Tomé and Príncipe.',
      rows: countries.filter((country) => country.stage === 'core'),
    },
    {
      key: 'expansion',
      title: 'Planned expansion',
      description:
        'Seeded as disabled. Enabling one opens registration and transfers for it; its providers stay disabled until you switch them on.',
      rows: countries.filter((country) => country.stage !== 'core'),
    },
  ];

  return (
    <>
      <PageHeader
        title="Countries"
        description={`${live} of ${countries.length} countries are live. A disabled country cannot register customers, send or receive.`}
      />
      {!canWrite ? (
        <Alert tone="info" className="mb-5">
          Only administrators can enable or disable a country.
        </Alert>
      ) : null}
      <div className="space-y-5">
        {groups.map((group) => (
          <Card key={group.key}>
            <CardHeader title={group.title} description={group.description} />
            <Table caption={group.title}>
              <THead>
                <Tr>
                  <Th>Country</Th>
                  <Th>Region</Th>
                  <Th>Currency</Th>
                  <Th>Providers</Th>
                  <Th>Risk</Th>
                  <Th>Status</Th>
                  {canWrite ? <Th>Actions</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {group.rows.map((country) => {
                  const own = providers.filter((provider) => provider.countryCode === country.code);
                  const active = own.filter((provider) => provider.status === 'ACTIVE').length;
                  return (
                    <Tr key={country.code} data-country={country.code}>
                      <Td>
                        <span className="font-medium text-fg">{country.name}</span>
                        <p className="text-xs text-fg-subtle">
                          {country.code} · {country.dialCode}
                        </p>
                      </Td>
                      <Td>{country.region}</Td>
                      <Td>{country.currency}</Td>
                      <Td>
                        {own.length === 0 ? (
                          <span className="text-fg-muted">Wallet delivery only</span>
                        ) : (
                          <Link
                            href={`/admin/providers?country=${country.code}`}
                            className="underline"
                          >
                            {active} active of {own.length}
                          </Link>
                        )}
                      </Td>
                      <Td>
                        {canWrite ? (
                          <ActionForm
                            action={setCountryRiskAction}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="code" value={country.code} />
                            <Select
                              name="riskLevel"
                              label={`Risk level of ${country.name}`}
                              hideLabel
                              defaultValue={country.riskLevel}
                              options={['LOW', 'MEDIUM', 'HIGH'].map((level) => ({
                                value: level,
                                label: humanize(level),
                              }))}
                              className="h-9 py-1"
                            />
                            <SubmitButton size="sm" variant="ghost">
                              Save<span className="sr-only"> risk level of {country.name}</span>
                            </SubmitButton>
                            <FormMessage showSuccess={false} className="basis-full text-xs" />
                          </ActionForm>
                        ) : (
                          <StatusBadge status={country.riskLevel} />
                        )}
                      </Td>
                      <Td>
                        <Badge tone={country.enabled ? 'success' : 'neutral'}>
                          {country.enabled
                            ? 'Enabled'
                            : country.stage === 'core'
                              ? 'Disabled'
                              : 'Planned'}
                        </Badge>
                      </Td>
                      {canWrite ? (
                        <Td>
                          <ActionButton
                            action={setCountryEnabledAction}
                            fields={{
                              code: country.code,
                              enabled: country.enabled ? 'false' : 'true',
                            }}
                            variant={country.enabled ? 'ghost' : 'primary'}
                            confirm={
                              country.enabled
                                ? `Disable ${country.name}? Its customers will not be able to send or receive.`
                                : undefined
                            }
                          >
                            {country.enabled ? 'Disable' : 'Enable'}
                            <span className="sr-only"> {country.name}</span>
                          </ActionButton>
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        ))}
        <RailsRegistry />
      </div>
    </>
  );
}
