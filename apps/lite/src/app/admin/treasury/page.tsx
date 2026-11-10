import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { BarChart } from '@/components/admin/charts';
import { Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  enumParam,
  flattenParams,
  positionInUse,
  usd,
} from '@/components/admin/helpers';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  Input,
  Money,
  PageHeader,
  Select,
  SimulatedBadge,
  Stat,
  StatGrid,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { getProviderReconciliation } from '@/server/backoffice';
import { listCountries } from '@/server/countries';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';
import {
  getReconciliation,
  getRevenueDashboard,
  getTreasuryDashboard,
  resolveRange,
} from '@/server/reports';

import { moveFloatAction, setThresholdAction } from './actions';

export const metadata: Metadata = { title: 'Treasury' };

const PERIODS = ['7', '30', '90'] as const;
const querySchema = z.object({ days: enumParam(PERIODS) });

const BREAK_LABELS = {
  AMOUNT_MISMATCH: 'Amounts differ',
  LEDGER_ONLY: 'In the ledger only',
  PROVIDER_ONLY: 'On the statement only',
} as const;

/** Treasury: float per currency, liquidity alerts, funding journals, profit and reconciliation. */
export default async function TreasuryPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('treasury:read');
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { days = '30' } = querySchema.parse(flattenParams(await searchParams));
  const range = resolveRange({ days });
  const [treasury, revenue, reconciliation, statements, liveCountries] = await Promise.all([
    getTreasuryDashboard(ctx, range),
    getRevenueDashboard(ctx, range),
    getReconciliation(ctx),
    getProviderReconciliation(ctx, range),
    listCountries({ enabled: true }),
  ]);
  // Currencies of planned countries hold nothing yet: list them, but do not raise alerts.
  const liveCurrencies = new Set(liveCountries.map((country) => country.currency));
  const positions = treasury.positions.filter((position) =>
    positionInUse(position, liveCurrencies),
  );
  const dormant = treasury.positions.filter((position) => !positionInUse(position, liveCurrencies));
  const alerts = treasury.alerts.filter((position) => positionInUse(position, liveCurrencies));
  const reserved = reconciliation.suspense.filter(
    (row) => row.expected !== 0n || row.actual !== 0n || !row.matches,
  );
  const canWrite = roleHasPermission(user.role, 'treasury:write');
  const currencyOptions = treasury.positions.map((position) => ({
    value: position.currency,
    label: position.currency,
  }));
  const breaks = statements.reduce((total, row) => total + row.breaks.length, 0);
  const unavailable = statements.filter((row) => row.statementSource === 'UNAVAILABLE').length;

  return (
    <>
      <PageHeader
        title="Treasury"
        description="Settlement (float) accounts per currency, liquidity against thresholds, manual funding, profit analytics and the reconciliation of the ledger against provider statements."
      />

      {alerts.length > 0 ? (
        <Alert
          tone={alerts.some((alert) => alert.liquidity === 'CRITICAL') ? 'danger' : 'warning'}
          title="Low liquidity"
          className="mb-5"
        >
          <ul className="list-disc space-y-0.5 pl-5" data-testid="liquidity-alerts">
            {alerts.map((alert) => (
              <li key={alert.currency}>
                <span className="font-medium">{alert.currency}</span> float is{' '}
                {alert.liquidity === 'CRITICAL'
                  ? 'at or below the critical level'
                  : 'below the low level'}
                : <Money amount={alert.float} currency={alert.currency} />
                {alert.lowBalance !== null ? (
                  <>
                    {' '}
                    (low{' '}
                    <Money amount={alert.lowBalance} currency={alert.currency} withCode={false} />
                    {alert.criticalBalance !== null ? (
                      <>
                        , critical{' '}
                        <Money
                          amount={alert.criticalBalance}
                          currency={alert.currency}
                          withCode={false}
                        />
                      </>
                    ) : null}
                    )
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" className="mb-5">
          Every float account in use is above its low-liquidity threshold.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Positions by currency"
          description="Float is the money held with operators (settlement account). Wallet balances are liabilities to customers and partners."
        />
        <Table caption="Treasury positions by currency">
          <THead>
            <Tr>
              <Th>Currency</Th>
              <Th>Liquidity</Th>
              <Th align="right">Float</Th>
              <Th align="right">Wallet liabilities</Th>
              <Th align="right">In suspense</Th>
              <Th align="right">FX position</Th>
              <Th align="right">Fee revenue</Th>
              <Th align="right">FX revenue</Th>
              <Th align="right">Commission payable</Th>
            </Tr>
          </THead>
          <TBody>
            {positions.map((position) => (
              <Tr key={position.currency} data-currency={position.currency}>
                <Td className="font-medium">{position.currency}</Td>
                <Td>
                  <StatusBadge
                    status={position.liquidity}
                    label={position.liquidity === 'OK' ? 'OK' : humanize(position.liquidity)}
                  />
                  <p className="tabular mt-0.5 whitespace-nowrap text-xs text-fg-muted">
                    {position.lowBalance === null ? (
                      'No threshold'
                    ) : (
                      <>
                        low{' '}
                        <Money
                          amount={position.lowBalance}
                          currency={position.currency}
                          withCode={false}
                        />
                        {' · critical '}
                        <Money
                          amount={position.criticalBalance ?? 0n}
                          currency={position.currency}
                          withCode={false}
                        />
                      </>
                    )}
                  </p>
                </Td>
                <Td align="right">
                  <Money amount={position.float} currency={position.currency} withCode={false} />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.walletLiabilities}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
                <Td align="right">
                  <Money amount={position.suspense} currency={position.currency} withCode={false} />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.fxPosition}
                    currency={position.currency}
                    withCode={false}
                    signed
                  />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.feeRevenue}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.fxRevenue}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
                <Td align="right">
                  <Money
                    amount={position.commissionPayable}
                    currency={position.currency}
                    withCode={false}
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {dormant.length > 0 ? (
          <CardBody className="border-t border-border text-xs text-fg-muted">
            Not in use yet (planned markets, nothing held):{' '}
            {dormant.map((position) => position.currency).join(', ')}. They raise no liquidity alert
            until their country is enabled or their float is funded.
          </CardBody>
        ) : null}
      </Card>

      {canWrite ? (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Liquidity thresholds"
              description="An alert shows when a float falls to the low level; critical is the level to act on immediately."
            />
            <CardBody>
              <ActionForm action={setThresholdAction} className="space-y-3">
                <Select
                  name="currency"
                  label="Currency"
                  required
                  placeholder="Choose a currency"
                  options={currencyOptions}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input name="lowBalance" label="Low level" required inputMode="decimal" />
                  <Input
                    name="criticalBalance"
                    label="Critical level"
                    required
                    inputMode="decimal"
                  />
                </div>
                <FormMessage />
                <SubmitButton size="sm" pendingLabel="Saving…">
                  Save thresholds
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Fund or rebalance a float"
              description="Posts one balanced adjustment journal: float against treasury capital."
            />
            <CardBody>
              <ActionForm action={moveFloatAction} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    name="currency"
                    label="Currency"
                    required
                    placeholder="Choose…"
                    options={currencyOptions}
                  />
                  <Select
                    name="direction"
                    label="Direction"
                    required
                    defaultValue="FUND"
                    options={[
                      { value: 'FUND', label: 'Fund the float' },
                      { value: 'WITHDRAW', label: 'Withdraw from the float' },
                    ]}
                  />
                </div>
                <Input name="amount" label="Amount" required inputMode="decimal" />
                <Textarea
                  name="reason"
                  label="Reason"
                  hint="E.g. the bank transfer reference that funded the operator account."
                  rows={2}
                  required
                  minLength={5}
                  maxLength={170}
                />
                <Input
                  name="approvedBy"
                  label="Four-eyes note"
                  hint="Who else approved this movement. Recorded in the journal and the audit log — Lite does not enforce a second sign-in."
                  required
                  minLength={3}
                  maxLength={100}
                />
                <FormMessage />
                <SubmitButton size="sm" pendingLabel="Posting…">
                  Post journal
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <h2 className="mt-8 mb-3 text-lg font-semibold text-fg">Profit analytics</h2>
      <Tabs
        label="Period"
        active={days}
        tabs={PERIODS.map((period) => ({
          key: period,
          label: `Last ${period} days`,
          href: period === '30' ? '/admin/treasury' : `/admin/treasury?days=${period}`,
        }))}
      />
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Total profit" value={usd(revenue.totals.revenueUsd)} hint="Fees + FX margin" />
        <Stat label="Fees" value={usd(revenue.totals.feeUsd)} />
        <Stat label="FX margin" value={usd(revenue.totals.fxMarginUsd)} />
      </StatGrid>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profit by day" description="Fees and FX margin, USD" />
          <CardBody>
            <BarChart
              title="Profit by day"
              seriesLabel="Fees"
              series2Label="FX margin"
              summary={`${usd(revenue.totals.revenueUsd)} over ${revenue.daily.length} days with activity.`}
              points={revenue.daily.map((day) => ({
                label: day.date,
                value: Number(day.feeUsd),
                display: usd(day.feeUsd),
                value2: Number(day.fxMarginUsd),
                display2: usd(day.fxMarginUsd),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="FX profitability by pair" description="Cross-currency transfers" />
          {treasury.fxPairs.length === 0 ? (
            <CardBody>
              <p className="text-sm text-fg-muted">No cross-currency transfer in this period.</p>
            </CardBody>
          ) : (
            <Table caption="FX profitability by currency pair">
              <THead>
                <Tr>
                  <Th>Pair</Th>
                  <Th align="right">Transfers</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">Margin (USD)</Th>
                </Tr>
              </THead>
              <TBody>
                {treasury.fxPairs.map((pair) => (
                  <Tr key={`${pair.sourceCurrency}-${pair.targetCurrency}`}>
                    <Td className="font-medium">
                      {pair.sourceCurrency}/{pair.targetCurrency}
                    </Td>
                    <Td align="right">{pair.count}</Td>
                    <Td align="right">
                      <Money amount={pair.fxMargin} currency={pair.sourceCurrency} />
                    </Td>
                    <Td align="right">{usd(pair.fxMarginUsd)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Profit by corridor" description="Completed transfers in the period" />
        {revenue.corridors.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">No completed transfer in this period.</p>
          </CardBody>
        ) : (
          <Table caption="Profit by corridor">
            <THead>
              <Tr>
                <Th>Corridor</Th>
                <Th>Currencies</Th>
                <Th align="right">Transfers</Th>
                <Th align="right">Value</Th>
                <Th align="right">Profit</Th>
                <Th align="right">of which FX</Th>
              </Tr>
            </THead>
            <TBody>
              {revenue.corridors.map((corridor) => (
                <Tr
                  key={`${corridor.sourceCountry}-${corridor.targetCountry}-${corridor.sourceCurrency}-${corridor.targetCurrency}`}
                >
                  <Td className="whitespace-nowrap">
                    {corridor.sourceCountry} → {corridor.targetCountry}
                  </Td>
                  <Td>
                    {corridor.sourceCurrency} → {corridor.targetCurrency}
                  </Td>
                  <Td align="right">{corridor.count}</Td>
                  <Td align="right">{usd(corridor.valueUsd)}</Td>
                  <Td align="right">{usd(corridor.revenueUsd)}</Td>
                  <Td align="right">{usd(corridor.fxMarginUsd)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <h2 id="reconciliation" className="mt-8 mb-3 scroll-mt-20 text-lg font-semibold text-fg">
        Reconciliation
      </h2>
      <Alert
        tone={reconciliation.healthy && breaks === 0 ? 'success' : 'danger'}
        title={
          reconciliation.healthy && breaks === 0
            ? 'Ledger and provider statements agree'
            : 'Reconciliation breaks need attention'
        }
        className="mb-5"
      >
        {reconciliation.healthy
          ? 'Debits equal credits in every currency, stored balances match their entries and reserved funds match the suspense accounts.'
          : 'The ledger integrity checks below report a difference.'}{' '}
        {breaks === 0
          ? 'No break against the provider statements in this period.'
          : `${breaks} break${breaks === 1 ? '' : 's'} against the provider statements.`}
        {unavailable > 0
          ? ` ${unavailable} provider statement${unavailable === 1 ? ' is' : 's are'} unavailable.`
          : ''}
      </Alert>

      <Card>
        <CardHeader
          title="Ledger vs provider statements"
          description="Net float movement booked per transfer, compared with the provider's statement for the selected period."
        />
        {statements.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">No provider movement in this period.</p>
          </CardBody>
        ) : (
          <Table caption="Ledger vs provider statements">
            <THead>
              <Tr>
                <Th>Provider</Th>
                <Th>Statement</Th>
                <Th align="right">References</Th>
                <Th align="right">Matched</Th>
                <Th align="right">Ledger net outflow</Th>
                <Th align="right">Statement net outflow</Th>
                <Th>Result</Th>
              </Tr>
            </THead>
            <TBody>
              {statements.map((row) => (
                <Tr key={row.providerId} data-reconciliation={row.code}>
                  <Td>
                    <Link
                      href={`/admin/providers/${row.providerId}`}
                      className="font-medium underline"
                    >
                      {row.name}
                    </Link>{' '}
                    {row.simulated ? <SimulatedBadge /> : null}
                  </Td>
                  <Td className="text-fg-muted">
                    {row.statementSource === 'OPERATOR'
                      ? 'Operator statement'
                      : row.statementSource === 'RECONSTRUCTED'
                        ? 'Rebuilt from simulator acknowledgements'
                        : `Unavailable — ${row.statementError ?? 'no statement'}`}
                  </Td>
                  <Td align="right">{row.references}</Td>
                  <Td align="right">{row.matched}</Td>
                  <Td align="right">
                    <Money amount={row.ledgerTotal} currency={row.currency} />
                  </Td>
                  <Td align="right">
                    {row.statementSource === 'UNAVAILABLE' ? (
                      '—'
                    ) : (
                      <Money amount={row.providerTotal} currency={row.currency} />
                    )}
                  </Td>
                  <Td>
                    {row.statementSource === 'UNAVAILABLE' ? (
                      <Badge tone="warning">Not reconciled</Badge>
                    ) : row.breaks.length === 0 ? (
                      <Badge tone="success">Reconciled</Badge>
                    ) : (
                      <Badge tone="danger">
                        {row.breaks.length} break{row.breaks.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {breaks > 0 ? (
          <div className="border-t border-border">
            <Table caption="Reconciliation breaks">
              <THead>
                <Tr>
                  <Th>Provider</Th>
                  <Th>Reference</Th>
                  <Th>Break</Th>
                  <Th align="right">Ledger</Th>
                  <Th align="right">Statement</Th>
                </Tr>
              </THead>
              <TBody>
                {statements.flatMap((row) =>
                  row.breaks.map((line) => (
                    <Tr key={`${row.providerId}-${line.reference}`}>
                      <Td>{row.name}</Td>
                      <Td>
                        {line.transferId ? (
                          <Link
                            href={`/admin/transfers/${line.transferId}`}
                            className="tabular font-medium underline"
                          >
                            {line.reference}
                          </Link>
                        ) : (
                          <span className="tabular">{line.reference}</span>
                        )}
                      </Td>
                      <Td>{BREAK_LABELS[line.kind]}</Td>
                      <Td align="right">
                        <Money amount={line.ledgerAmount} currency={line.currency} />
                      </Td>
                      <Td align="right">
                        <Money amount={line.providerAmount} currency={line.currency} />
                      </Td>
                    </Tr>
                  )),
                )}
              </TBody>
            </Table>
          </div>
        ) : null}
        <CardBody className="border-t border-border text-xs text-fg-muted">
          Sandbox providers keep no statement of their own, so their side is rebuilt from the
          outcomes the simulator acknowledged for each transfer and compared with the float entries
          in the ledger. Providers on the HTTP adapter are asked for their real statement.
        </CardBody>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ledger integrity" description="Whole ledger, per currency" />
          <Table caption="Ledger integrity per currency">
            <THead>
              <Tr>
                <Th>Currency</Th>
                <Th align="right">Debits</Th>
                <Th align="right">Credits</Th>
                <Th align="right">Unbalanced journals</Th>
                <Th align="right">Drifting accounts</Th>
                <Th>Result</Th>
              </Tr>
            </THead>
            <TBody>
              {reconciliation.integrity.map((row) => (
                <Tr key={row.currency}>
                  <Td className="font-medium">{row.currency}</Td>
                  <Td align="right">
                    <Money amount={row.totalDebits} currency={row.currency} withCode={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={row.totalCredits} currency={row.currency} withCode={false} />
                  </Td>
                  <Td align="right">{row.unbalancedJournals}</Td>
                  <Td align="right">{row.driftingAccounts + row.negativeWallets}</Td>
                  <Td>
                    <Badge tone={row.balanced ? 'success' : 'danger'}>
                      {row.balanced ? 'Balanced' : 'Out of balance'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader
            title="Reserved funds"
            description="Held and in-flight transfers must equal the suspense accounts"
          />
          {reserved.length === 0 ? (
            <CardBody>
              <p className="text-sm text-fg-muted">
                Nothing is reserved and every suspense account is empty.
              </p>
            </CardBody>
          ) : (
            <Table caption="Reserved funds versus suspense accounts">
              <THead>
                <Tr>
                  <Th>Currency</Th>
                  <Th align="right">Expected</Th>
                  <Th align="right">Suspense account</Th>
                  <Th>Result</Th>
                </Tr>
              </THead>
              <TBody>
                {reserved.map((row) => (
                  <Tr key={row.currency}>
                    <Td className="font-medium">{row.currency}</Td>
                    <Td align="right">
                      <Money amount={row.expected} currency={row.currency} withCode={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={row.actual} currency={row.currency} withCode={false} />
                    </Td>
                    <Td>
                      <Badge tone={row.matches ? 'success' : 'danger'}>
                        {row.matches ? 'Matches' : 'Difference'}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="In flight with providers"
          description="Payouts waiting for the provider's final answer"
        />
        {reconciliation.inFlight.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-muted">Nothing is waiting for a provider.</p>
          </CardBody>
        ) : (
          <Table caption="Transfers in flight with providers">
            <THead>
              <Tr>
                <Th>Reference</Th>
                <Th>Provider</Th>
                <Th>Provider reference</Th>
                <Th align="right">Reserved</Th>
                <Th>Since</Th>
              </Tr>
            </THead>
            <TBody>
              {reconciliation.inFlight.map((transfer) => (
                <Tr key={transfer.id}>
                  <Td>
                    <Link
                      href={`/admin/transfers/${transfer.id}`}
                      className="tabular font-medium underline"
                    >
                      {transfer.reference}
                    </Link>
                  </Td>
                  <Td>{transfer.provider?.name ?? '—'}</Td>
                  <Td className="font-mono text-xs">{transfer.providerRef ?? '—'}</Td>
                  <Td align="right">
                    <Money amount={transfer.totalDebit} currency={transfer.sourceCurrency} />
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(transfer.createdAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {reconciliation.unposted.length > 0 ? (
          <CardBody className="border-t border-border">
            <Alert tone="danger" title="Completed transfers without a settlement journal">
              {reconciliation.unposted.map((row) => row.reference).join(', ')}
            </Alert>
          </CardBody>
        ) : null}
      </Card>
    </>
  );
}
