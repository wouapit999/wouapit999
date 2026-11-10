import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { ActionButton } from '@/components/admin/action-button';
import { type SearchParams, enumParam, flattenParams, uuidParam } from '@/components/admin/helpers';
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
  Money,
  PageHeader,
  Select,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { TRANSFER_TYPES, listFeeRules } from '@/server/fees';
import { CURRENCY_CODES, toMajorString } from '@/server/money';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import { saveFeeRuleAction, setFeeRuleActiveAction } from './actions';

export const metadata: Metadata = { title: 'Fees' };

const TYPE_LABELS: Record<(typeof TRANSFER_TYPES)[number], string> = {
  W2W: 'Wallet to wallet',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International',
  TOPUP: 'Top-up',
};

const querySchema = z.object({
  edit: uuidParam,
  new: enumParam(['1']),
  saved: enumParam(['created', 'updated']),
  currency: enumParam(CURRENCY_CODES as [string, ...string[]]),
});

/** Fee rules: fee = fixed + amount × bps, clamped to [minimum, cap]; most specific rule wins. */
export default async function FeesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const [rules, countries] = await Promise.all([listFeeRules(ctx), listCountries()]);
  const canWrite = roleHasPermission(user.role, 'fees:write');
  const editing = canWrite ? rules.find((rule) => rule.id === query.edit) : undefined;
  const showForm = canWrite && (editing !== undefined || query.new === '1');
  const visible = query.currency ? rules.filter((rule) => rule.currency === query.currency) : rules;
  const currencies = [...new Set(rules.map((rule) => rule.currency))];
  const countryOptions = countries.map((country) => ({
    value: country.code,
    label: `${country.name} (${country.code})`,
  }));

  return (
    <>
      <PageHeader
        title="Fee rules"
        description="The fee is charged in the source currency on top of the send amount. When several rules match, the most specific one wins: transfer type, then source country, then target country, then priority."
        actions={
          canWrite && !showForm ? (
            <LinkButton href="/admin/fees?new=1">New fee rule</LinkButton>
          ) : undefined
        }
      />
      {query.saved ? (
        <Alert tone="success" className="mb-5">
          Fee rule {query.saved}. It applies to new quotes immediately; locked quotes keep their
          price.
        </Alert>
      ) : null}

      {showForm ? (
        <Card className="mb-5">
          <CardHeader
            title={editing ? `Edit “${editing.name}”` : 'New fee rule'}
            description="Amounts are in the rule's currency. Leave minimum and cap empty for none."
          />
          <CardBody>
            <ActionForm action={saveFeeRuleAction} className="space-y-4">
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  name="name"
                  label="Rule name"
                  required
                  defaultValue={editing?.name}
                  maxLength={120}
                />
                <Select
                  name="transferType"
                  label="Transfer type"
                  placeholder="Any type"
                  defaultValue={editing?.transferType ?? undefined}
                  options={TRANSFER_TYPES.map((type) => ({
                    value: type,
                    label: TYPE_LABELS[type],
                  }))}
                />
                <Select
                  name="currency"
                  label="Currency"
                  required
                  placeholder="Choose a currency"
                  defaultValue={editing?.currency}
                  options={CURRENCY_CODES.map((currency) => ({ value: currency, label: currency }))}
                />
                <Select
                  name="sourceCountry"
                  label="Source country"
                  placeholder="Any country"
                  defaultValue={editing?.sourceCountry ?? undefined}
                  options={countryOptions}
                />
                <Select
                  name="targetCountry"
                  label="Target country"
                  placeholder="Any country"
                  defaultValue={editing?.targetCountry ?? undefined}
                  options={countryOptions}
                />
                <Input
                  name="priority"
                  type="number"
                  label="Priority"
                  hint="Higher wins between equally specific rules."
                  min={0}
                  max={1000}
                  defaultValue={editing?.priority ?? 0}
                />
                <Input
                  name="fixedAmount"
                  label="Fixed fee"
                  inputMode="decimal"
                  hint="Flat amount per transfer, e.g. 100"
                  defaultValue={
                    editing ? toMajorString(editing.fixedAmount, editing.currency) : '0'
                  }
                />
                <Input
                  name="percentBps"
                  type="number"
                  label="Variable fee (basis points)"
                  hint="150 bps = 1.50% of the send amount"
                  required
                  min={0}
                  max={5000}
                  step={1}
                  defaultValue={editing?.percentBps ?? 0}
                />
                <Input
                  name="minFee"
                  label="Minimum fee"
                  inputMode="decimal"
                  defaultValue={
                    editing?.minFee == null
                      ? undefined
                      : toMajorString(editing.minFee, editing.currency)
                  }
                />
                <Input
                  name="maxFee"
                  label="Cap (maximum fee)"
                  inputMode="decimal"
                  defaultValue={
                    editing?.maxFee == null
                      ? undefined
                      : toMajorString(editing.maxFee, editing.currency)
                  }
                />
              </div>
              <Checkbox
                name="active"
                label="Active"
                hint="Inactive rules are kept for history but never applied."
                defaultChecked={editing?.active ?? true}
              />
              <FormMessage />
              <FormActions>
                <SubmitButton pendingLabel="Saving…">
                  {editing ? 'Save changes' : 'Create rule'}
                </SubmitButton>
                <LinkButton href="/admin/fees" variant="ghost">
                  Cancel
                </LinkButton>
              </FormActions>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Rules"
          description={`${visible.length} rule${visible.length === 1 ? '' : 's'}${query.currency ? ` in ${query.currency}` : ''}. Rules are never deleted, so past quotes stay explainable.`}
        />
        <nav
          aria-label="Filter by currency"
          className="flex flex-wrap gap-1 border-b border-border px-5 py-3 text-xs sm:px-6"
        >
          <Link
            href="/admin/fees"
            aria-current={query.currency ? undefined : 'true'}
            className="rounded-full border border-border px-2 py-1 text-fg-muted hover:text-fg aria-[current]:bg-accent-soft aria-[current]:text-accent"
          >
            All
          </Link>
          {currencies.map((currency) => (
            <Link
              key={currency}
              href={`/admin/fees?currency=${currency}`}
              aria-current={query.currency === currency ? 'true' : undefined}
              className="rounded-full border border-border px-2 py-1 text-fg-muted hover:text-fg aria-[current]:bg-accent-soft aria-[current]:text-accent"
            >
              {currency}
            </Link>
          ))}
        </nav>
        {visible.length === 0 ? (
          <EmptyState
            title="No fee rule"
            description="Without a rule, transfers use the built-in default of 1.00% (top-ups are free)."
          />
        ) : (
          <Table caption="Fee rules">
            <THead>
              <Tr>
                <Th>Rule</Th>
                <Th>Applies to</Th>
                <Th>Corridor</Th>
                <Th align="right">Fixed</Th>
                <Th align="right">Variable</Th>
                <Th align="right">Minimum</Th>
                <Th align="right">Cap</Th>
                <Th>Status</Th>
                {canWrite ? <Th>Actions</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {visible.map((rule) => (
                <Tr key={rule.id} data-fee-rule={rule.code}>
                  <Td>
                    <span className="font-medium text-fg">{rule.name}</span>
                    <p className="text-xs text-fg-subtle">
                      {rule.currency} · priority {rule.priority}
                    </p>
                  </Td>
                  <Td>{rule.transferType ? TYPE_LABELS[rule.transferType] : 'Any type'}</Td>
                  <Td className="whitespace-nowrap">
                    {rule.sourceCountry ?? 'Any'} → {rule.targetCountry ?? 'Any'}
                  </Td>
                  <Td align="right">
                    <Money amount={rule.fixedAmount} currency={rule.currency} />
                  </Td>
                  <Td align="right">{formatBps(rule.percentBps)}</Td>
                  <Td align="right">
                    {rule.minFee === null ? (
                      '—'
                    ) : (
                      <Money amount={rule.minFee} currency={rule.currency} />
                    )}
                  </Td>
                  <Td align="right">
                    {rule.maxFee === null ? (
                      '—'
                    ) : (
                      <Money amount={rule.maxFee} currency={rule.currency} />
                    )}
                  </Td>
                  <Td>
                    <Badge tone={rule.active ? 'success' : 'neutral'}>
                      {rule.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  {canWrite ? (
                    <Td>
                      <div className="flex flex-wrap items-start gap-2">
                        <LinkButton
                          href={`/admin/fees?edit=${rule.id}`}
                          variant="secondary"
                          size="sm"
                        >
                          Edit<span className="sr-only"> {rule.name}</span>
                        </LinkButton>
                        <ActionButton
                          action={setFeeRuleActiveAction}
                          fields={{ id: rule.id, active: rule.active ? 'false' : 'true' }}
                          variant="ghost"
                        >
                          {rule.active ? 'Deactivate' : 'Activate'}
                          <span className="sr-only"> {rule.name}</span>
                        </ActionButton>
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-fg-muted">
        Transfer types:{' '}
        {TRANSFER_TYPES.map((type) => `${type} — ${humanize(TYPE_LABELS[type])}`).join(' · ')}.
      </p>
    </>
  );
}
