import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { Tabs } from '@/components/admin/filter-bar';
import { type SearchParams, enumParam, flattenParams } from '@/components/admin/helpers';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  FormActions,
  FormMessage,
  Input,
  LinkButton,
  PageHeader,
  Select,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDateTime } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listFxRates } from '@/server/fx';
import {
  CURRENCY_CODES,
  applyMargin,
  currencyInfo,
  formatRate,
  parseRate,
  rateToDecimalString,
} from '@/server/money';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { setFxRateAction } from './actions';

export const metadata: Metadata = { title: 'FX rates' };

const currencyEnum = CURRENCY_CODES as [string, ...string[]];
const querySchema = z.object({
  base: enumParam(currencyEnum),
  edit: z
    .string()
    .regex(/^[A-Z]{3}-[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  saved: z
    .string()
    .regex(/^[A-Z]{3}-[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  inverse: enumParam(['1']),
});

const currencyOptions = CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${code} — ${currencyInfo(code).name}`,
}));

/** FX rate table: mid rate, margin and customer rate per pair, with audited manual overrides. */
export default async function FxPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const base = query.base ?? query.edit?.slice(0, 3) ?? 'XAF';
  const rates = await listFxRates(ctx, { baseCurrency: base });
  const canWrite = roleHasPermission(user.role, 'fx:write');
  const editing = query.edit
    ? rates.find((rate) => `${rate.baseCurrency}-${rate.quoteCurrency}` === query.edit)
    : undefined;
  const manual = rates.filter((rate) => rate.source === 'manual').length;

  return (
    <>
      <PageHeader
        title="FX rates"
        description="The customer rate is the mid rate reduced by the margin; the margin is booked as FX revenue on every cross-currency transfer. Quotes that are already locked keep their rate until they expire."
      />
      {query.saved ? (
        <Alert tone="success" className="mb-5">
          Rate {query.saved.replace('-', '/')} overridden
          {query.inverse ? ' together with its inverse pair' : ''}. The change and its reason are in
          the audit log.
        </Alert>
      ) : null}

      <Tabs
        label="Base currency"
        active={base}
        tabs={CURRENCY_CODES.map((code) => ({
          key: code,
          label: code,
          href: `/admin/fx?base=${code}`,
        }))}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Rates from ${base}`}
            description={`${rates.length} pairs · ${manual} set by hand`}
          />
          {rates.length === 0 ? (
            <EmptyState title={`No rate is stored with ${base} as the base currency`} />
          ) : (
            <Table caption={`FX rates from ${base}`}>
              <THead>
                <Tr>
                  <Th>Pair</Th>
                  <Th align="right">Mid rate</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">Customer rate</Th>
                  <Th>Source</Th>
                  <Th>Updated</Th>
                  {canWrite ? <Th>Actions</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {rates.map((rate) => {
                  const mid = parseRate(rate.midRate);
                  const pair = `${rate.baseCurrency}-${rate.quoteCurrency}`;
                  return (
                    <Tr key={rate.id} data-fx-pair={pair}>
                      <Td className="font-medium">
                        {rate.baseCurrency}/{rate.quoteCurrency}
                      </Td>
                      <Td align="right">{formatRate(mid, 4)}</Td>
                      <Td align="right">
                        {formatBps(rate.marginBps)}
                        <span className="sr-only"> ({rate.marginBps} basis points)</span>
                      </Td>
                      <Td align="right">{formatRate(applyMargin(mid, rate.marginBps), 4)}</Td>
                      <Td>
                        <Badge tone={rate.source === 'manual' ? 'gold' : 'neutral'}>
                          {rate.source === 'manual' ? 'Manual override' : rate.source}
                        </Badge>
                      </Td>
                      <Td className="text-fg-muted">{formatDateTime(rate.updatedAt)}</Td>
                      {canWrite ? (
                        <Td>
                          <LinkButton
                            href={`/admin/fx?base=${base}&edit=${pair}#override`}
                            variant="secondary"
                            size="sm"
                          >
                            Override<span className="sr-only"> {pair.replace('-', '/')}</span>
                          </LinkButton>
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <Card id="override">
          <CardHeader
            title="Manual override"
            description={
              canWrite
                ? 'Set a rate or margin by hand. Seed rates are illustrative; there is no live rate feed in BI-Rem Lite.'
                : 'Only treasury officers and administrators can change rates.'
            }
          />
          {canWrite ? (
            <CardBody>
              <ActionForm
                key={editing ? editing.id : 'new'}
                action={setFxRateAction}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    name="baseCurrency"
                    label="Base"
                    required
                    defaultValue={editing?.baseCurrency ?? base}
                    options={currencyOptions}
                  />
                  <Select
                    name="quoteCurrency"
                    label="Quote"
                    required
                    placeholder="Choose…"
                    defaultValue={editing?.quoteCurrency}
                    options={currencyOptions}
                  />
                </div>
                <Input
                  name="midRate"
                  label="Mid rate"
                  hint="Units of the quote currency for 1 unit of the base currency (up to 10 decimals)."
                  required
                  inputMode="decimal"
                  pattern="\d{1,12}(\.\d{1,10})?"
                  defaultValue={
                    editing ? rateToDecimalString(parseRate(editing.midRate)) : undefined
                  }
                />
                <Input
                  name="marginBps"
                  type="number"
                  label="Margin (basis points)"
                  hint="150 bps = 1.50% taken from the mid rate."
                  required
                  min={0}
                  max={2000}
                  step={1}
                  defaultValue={editing?.marginBps ?? 150}
                />
                <Checkbox
                  name="updateInverse"
                  label="Also update the inverse pair"
                  hint="Sets quote/base to 1 ÷ mid rate with the same margin."
                />
                <Textarea
                  name="reason"
                  label="Reason for the override"
                  rows={2}
                  required
                  minLength={5}
                  maxLength={300}
                />
                <FormMessage />
                <FormActions>
                  <SubmitButton pendingLabel="Saving…">Apply override</SubmitButton>
                  {editing ? (
                    <Link
                      href={`/admin/fx?base=${base}`}
                      className="text-sm text-fg-muted underline"
                    >
                      Clear
                    </Link>
                  ) : null}
                </FormActions>
              </ActionForm>
            </CardBody>
          ) : null}
        </Card>
      </div>
    </>
  );
}
