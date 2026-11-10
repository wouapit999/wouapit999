'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  ActionForm,
  Alert,
  Button,
  FormActions,
  FormMessage,
  Input,
  Money,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import type { TransferStatus } from '@/generated/prisma/enums';
import type { ActionState } from '@/lib/action-state';

export interface CashInPreview {
  customer: string;
  amountText: string;
  customerName: string;
  customerAccount: string;
  currency: string;
  amount: string;
  fee: string;
  totalDebit: string;
  floatBalance: string;
  sufficient: boolean;
  idempotencyKey: string;
}

export interface CashInResult {
  id: string;
  reference: string;
  status: TransferStatus;
  customerName: string;
  currency: string;
  amount: string;
  totalDebit: string;
}

type Action<T> = (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;

/**
 * Agent cash-in in two steps: look the customer up and see the cost, then confirm once the cash
 * is in hand. The confirmation carries an idempotency key minted by the server with the preview,
 * so a double click or a retry after a network error can only credit the customer once.
 */
export function CashInFlow({
  previewAction,
  confirmAction,
  currency,
  disabled = false,
}: {
  previewAction: Action<CashInPreview>;
  confirmAction: Action<CashInResult>;
  currency: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<CashInPreview | null>(null);
  const [result, setResult] = useState<CashInResult | null>(null);

  if (result) {
    const completed = result.status === 'COMPLETED';
    return (
      <div className="space-y-4" data-testid="cash-in-result">
        <Alert
          tone={completed ? 'success' : 'warning'}
          title={completed ? 'Customer credited' : 'Cash-in is under review'}
        >
          <p>
            {completed ? (
              <>
                <Money amount={result.amount} currency={result.currency} /> is now in{' '}
                {result.customerName}&apos;s wallet.
              </>
            ) : (
              <>
                The amount is reserved from your float while BI-Rem compliance reviews this cash-in.
                Keep the cash until it is released or refunded.
              </>
            )}{' '}
            <Money amount={result.totalDebit} currency={result.currency} /> left your float.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/partner/transactions/${result.id}`}
              className="font-mono font-medium underline"
            >
              {result.reference}
            </Link>
            <StatusBadge status={result.status} />
          </p>
        </Alert>
        <Button variant="secondary" size="sm" onClick={() => setResult(null)}>
          New cash-in
        </Button>
      </div>
    );
  }

  if (preview) {
    return (
      <ActionForm
        action={confirmAction}
        className="space-y-4"
        onResult={(state) => {
          if (state.ok && state.data) {
            setResult(state.data);
            setPreview(null);
          }
        }}
      >
        <input type="hidden" name="customer" value={preview.customer} />
        <input type="hidden" name="amount" value={preview.amountText} />
        <input type="hidden" name="idempotencyKey" value={preview.idempotencyKey} />
        <dl
          className="divide-y divide-border rounded-lg border border-border text-sm"
          data-testid="cash-in-preview"
        >
          <div className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="text-fg-muted">Customer</dt>
            <dd className="text-right font-medium text-fg">
              {preview.customerName}
              <span className="block text-xs font-normal text-fg-subtle">
                {preview.customerAccount}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-fg-muted">Credited to the customer</dt>
            <dd className="font-semibold text-fg">
              <Money amount={preview.amount} currency={preview.currency} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-fg-muted">Transfer fee</dt>
            <dd>
              <Money amount={preview.fee} currency={preview.currency} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-fg-muted">Debited from your float</dt>
            <dd className="font-semibold text-fg">
              <Money amount={preview.totalDebit} currency={preview.currency} />
            </dd>
          </div>
        </dl>
        {preview.sufficient ? (
          <p className="text-sm text-fg-muted">
            Confirm only once you hold{' '}
            <Money amount={preview.amount} currency={preview.currency} className="font-medium" /> in
            cash from this customer. A completed cash-in cannot be undone from the portal.
          </p>
        ) : (
          <Alert tone="danger" title="Not enough float">
            Your float is <Money amount={preview.floatBalance} currency={preview.currency} />. Ask
            BI-Rem to fund it, or enter a smaller amount.
          </Alert>
        )}
        <FormMessage showSuccess={false} />
        <FormActions>
          <SubmitButton pendingLabel="Crediting…" disabled={preview.sufficient ? undefined : true}>
            Confirm cash-in
          </SubmitButton>
          <Button variant="ghost" onClick={() => setPreview(null)}>
            Back
          </Button>
        </FormActions>
      </ActionForm>
    );
  }

  return (
    <ActionForm
      action={previewAction}
      className="space-y-4"
      onResult={(state) => {
        if (state.ok && state.data) setPreview(state.data);
      }}
    >
      <Input
        name="customer"
        label="Customer phone number or e-mail"
        placeholder="+237699000101"
        hint="The customer's BI-Rem account. You will see their name before anything moves."
        autoComplete="off"
        required
        disabled={disabled}
      />
      <Input
        name="amount"
        label={`Cash received (${currency})`}
        inputMode="decimal"
        placeholder="10 000"
        autoComplete="off"
        required
        disabled={disabled}
      />
      <FormMessage showSuccess={false} />
      <FormActions>
        <SubmitButton pendingLabel="Checking…" disabled={disabled || undefined}>
          Review cash-in
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
