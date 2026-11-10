'use client';

import Link from 'next/link';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';

import { type ActionData, callAction, errorsOf } from '@/app/app/_lib/client';
import {
  PURPOSE_LABELS,
  SOURCE_OF_FUNDS_LABELS,
  labelFor,
  transferKindLabel,
} from '@/app/app/_lib/labels';
import {
  type RecipientDraft,
  type RecipientType,
  type SendScope,
  describeOutcome,
  formatCountdown,
  recipientPayload,
  recipientTypesFor,
} from '@/app/app/_lib/send';
import {
  confirmTransferAction,
  estimateTransferAction,
  lockQuoteAction,
  resolveRecipientAction,
} from '@/app/app/send/actions';
import {
  Alert,
  Button,
  DescriptionList,
  Input,
  LinkButton,
  Money,
  Select,
  SimulatedBadge,
  StatusBadge,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBps } from '@/lib/format';

// ---------------------------------------------------------------------------
// Props (everything is serialisable: amounts are minor-unit strings)
// ---------------------------------------------------------------------------

export interface SendWalletOption {
  readonly id: string;
  readonly currency: string;
  readonly balance: string;
}

export interface SendCountryOption {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
}

export interface SendProviderOption {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly simulated: boolean;
}

export interface SendBeneficiaryOption {
  readonly id: string;
  readonly label: string;
  readonly countryCode: string;
}

export interface SendFlowProps {
  wallets: readonly SendWalletOption[];
  home: SendCountryOption;
  /** Enabled destination countries other than the customer's own. */
  corridors: readonly SendCountryOption[];
  /** Providers that can pay out, in every enabled country. */
  providers: readonly SendProviderOption[];
  beneficiaries: readonly SendBeneficiaryOption[];
  purposes: readonly string[];
  sourcesOfFunds: readonly string[];
  /** False when the customer's KYC tier does not allow international transfers. */
  internationalAllowed: boolean;
  initialBeneficiaryId?: string;
  initialWalletId?: string;
}

type Resolved = ActionData<typeof resolveRecipientAction>;
type Estimate = ActionData<typeof estimateTransferAction>;
type Quote = ActionData<typeof lockQuoteAction>;
type Result = ActionData<typeof confirmTransferAction>;

type Step = 'recipient' | 'amount' | 'review' | 'done';

const STEPS: ReadonlyArray<{ key: Step; label: string }> = [
  { key: 'recipient', label: 'Recipient' },
  { key: 'amount', label: 'Amount' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

const TYPE_COPY: Readonly<
  Record<RecipientType, { title: string; domestic: string; international: string }>
> = {
  PERSON: {
    title: 'BI-Rem customer',
    domestic: 'To their wallet, by phone or e-mail',
    international: 'To their BI-Rem wallet abroad',
  },
  MERCHANT: { title: 'Merchant', domestic: 'Pay a shop with its code', international: '' },
  AGENT: { title: 'Agent', domestic: 'Cash out at an agent', international: '' },
  MOBILE_MONEY: {
    title: 'Mobile money',
    domestic: 'To a mobile-money number',
    international: 'To a mobile-money number abroad',
  },
  BENEFICIARY: {
    title: 'Saved beneficiary',
    domestic: 'Someone you already saved',
    international: 'Someone you already saved',
  },
};

interface Errors {
  readonly message?: string;
  readonly fields: Readonly<Record<string, string>>;
}
const NO_ERRORS: Errors = { fields: {} };

type EstimateState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly data?: Estimate }
  | { readonly status: 'ready'; readonly data: Estimate }
  | { readonly status: 'error'; readonly message: string };

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: Step }) {
  const index = STEPS.findIndex((step) => step.key === current);
  return (
    <ol aria-label="Progress" className="flex items-center gap-1.5 text-xs sm:gap-2 sm:text-sm">
      {STEPS.map((step, position) => {
        const state = position < index ? 'done' : position === index ? 'current' : 'todo';
        return (
          <li
            key={step.key}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5 sm:flex-1',
              state === 'current' && 'flex-1',
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                state === 'current' && 'bg-accent text-accent-fg',
                state === 'done' && 'bg-accent-soft text-accent',
                state === 'todo' && 'bg-surface-muted text-fg-subtle',
              )}
            >
              {state === 'done' ? '✓' : position + 1}
            </span>
            <span
              className={cn(
                'truncate',
                // On a phone only the current step is spelled out; the others keep their number.
                state === 'current'
                  ? 'font-semibold text-fg'
                  : 'sr-only text-fg-muted sm:not-sr-only',
              )}
            >
              {step.label}
              {state === 'done' ? <span className="sr-only"> (completed)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface CardOption<Value extends string> {
  readonly value: Value;
  readonly title: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

/** A radio group drawn as selectable cards (keyboard and screen-reader friendly). */
function RadioCards<Value extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  error,
  columns = 2,
}: {
  legend: string;
  name: string;
  value: Value;
  options: ReadonlyArray<CardOption<Value>>;
  onChange: (value: Value) => void;
  error?: string;
  columns?: 2 | 3;
}) {
  return (
    <fieldset aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      <div className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative flex cursor-pointer flex-col rounded-lg border px-3.5 py-3 text-sm transition-colors',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
              option.value === value
                ? 'border-accent bg-accent-soft'
                : 'border-border-strong bg-surface-raised hover:border-fg-subtle',
              option.disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="absolute size-px opacity-0"
            />
            <span className="font-semibold text-fg">{option.title}</span>
            {option.description ? (
              <span className="mt-0.5 text-xs text-fg-muted">{option.description}</span>
            ) : null}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${name}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Counts down to `deadline` (epoch ms on this device) and reports when it is reached. */
function Countdown({
  deadline,
  initialSeconds,
  onExpire,
}: {
  deadline: number;
  initialSeconds: number;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(initialSeconds);
  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(Math.ceil((deadline - Date.now()) / 1000), 0);
      setRemaining(left);
      if (left === 0) onExpire();
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onExpire]);
  return (
    <span role="timer" aria-label="Time left on this price" className="tabular font-semibold">
      {formatCountdown(remaining)}
    </span>
  );
}

function PriceLines({
  price,
  dimmed = false,
}: {
  price: Pick<
    Estimate,
    | 'sendAmount'
    | 'feeAmount'
    | 'totalDebit'
    | 'receiveAmount'
    | 'sourceCurrency'
    | 'targetCurrency'
    | 'rate'
    | 'marginBps'
  >;
  dimmed?: boolean;
}) {
  const rows: Array<{ label: string; value: ReactNode; strong?: boolean }> = [
    {
      label: 'You send',
      value: <Money amount={price.sendAmount} currency={price.sourceCurrency} />,
    },
    { label: 'Fee', value: <Money amount={price.feeAmount} currency={price.sourceCurrency} /> },
    {
      label: 'Total debited from your wallet',
      value: <Money amount={price.totalDebit} currency={price.sourceCurrency} />,
      strong: true,
    },
  ];
  if (price.rate) {
    rows.push({
      label: 'Exchange rate',
      value: (
        <span className="tabular">
          1 {price.sourceCurrency} = {price.rate} {price.targetCurrency}
          <span className="block text-xs font-normal text-fg-muted">
            includes a {formatBps(price.marginBps)} FX margin
          </span>
        </span>
      ),
    });
  }
  rows.push({
    label: 'Recipient gets',
    value: <Money amount={price.receiveAmount} currency={price.targetCurrency} />,
    strong: true,
  });
  return (
    <dl className={cn('divide-y divide-border text-sm', dimmed && 'opacity-60')}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4 py-2">
          <dt className="text-fg-muted">{row.label}</dt>
          <dd className={cn('text-right text-fg', row.strong && 'font-semibold')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecipientSummary({ resolved }: { resolved: Resolved }) {
  const { recipient } = resolved;
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
        {recipient.name}
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {transferKindLabel(resolved.type, recipient.deliveryMethod)}
        </span>
      </p>
      <p className="mt-0.5 break-all text-fg-muted">{recipient.account}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span>
          {recipient.countryName} · receives in {recipient.currency} ·{' '}
          {recipient.deliveryMethod === 'MOBILE_MONEY'
            ? (recipient.providerName ?? 'Mobile money')
            : 'BI-Rem wallet'}
        </span>
        {recipient.simulated ? <SimulatedBadge /> : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------

/**
 * Guided "Send money" flow: recipient → amount (live fee and FX estimate) → review (price
 * locked, countdown, one idempotency key) → outcome. The server re-resolves the recipient and
 * re-checks ownership, limits and balance at every step; this component only holds the draft.
 */
export function SendFlow({
  wallets,
  home,
  corridors,
  providers,
  beneficiaries,
  purposes,
  sourcesOfFunds,
  internationalAllowed,
  initialBeneficiaryId,
  initialWalletId,
}: SendFlowProps) {
  const initialBeneficiary = beneficiaries.find((item) => item.id === initialBeneficiaryId);
  const blankDraft = (): RecipientDraft => ({
    senderWalletId:
      (wallets.find((wallet) => wallet.id === initialWalletId) ?? wallets[0])?.id ?? '',
    scope: 'DOMESTIC',
    targetCountry: '',
    recipientType: 'PERSON',
    identifier: '',
    providerId: '',
    accountNumber: '',
    recipientName: '',
    beneficiaryId: '',
  });

  const [step, setStep] = useState<Step>('recipient');
  const [draft, setDraft] = useState<RecipientDraft>(() =>
    initialBeneficiary
      ? {
          ...blankDraft(),
          scope: initialBeneficiary.countryCode === home.code ? 'DOMESTIC' : 'INTERNATIONAL',
          recipientType: 'BENEFICIARY',
          beneficiaryId: initialBeneficiary.id,
        }
      : blankDraft(),
  );
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState('');
  const [note, setNote] = useState('');
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [expired, setExpired] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimateSeq = useRef(0);

  // Move focus to the step title when the step changes (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(
    () => () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    },
    [],
  );

  const markExpired = useCallback(() => setExpired(true), []);

  const wallet = wallets.find((candidate) => candidate.id === draft.senderWalletId) ?? wallets[0];
  const international = draft.scope === 'INTERNATIONAL';
  const hasBeneficiaries = beneficiaries.length > 0;
  const typeOptions = recipientTypesFor(draft.scope, hasBeneficiaries);
  const payoutCountry = international ? draft.targetCountry : home.code;
  const payoutProviders = providers.filter((provider) => provider.countryCode === payoutCountry);
  const scopedBeneficiaries = beneficiaries.filter((item) =>
    international ? item.countryCode !== home.code : item.countryCode === home.code,
  );
  const targetCountryName =
    corridors.find((country) => country.code === draft.targetCountry)?.name ?? 'that country';

  function update(patch: Partial<RecipientDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors(NO_ERRORS);
  }

  function changeScope(scope: SendScope) {
    const allowed = recipientTypesFor(scope, hasBeneficiaries);
    update({
      scope,
      recipientType: allowed.includes(draft.recipientType) ? draft.recipientType : 'PERSON',
      providerId: '',
      beneficiaryId: '',
    });
  }

  function runEstimate(text: string, forDraft: RecipientDraft) {
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    const sequence = ++estimateSeq.current;
    if (text.trim() === '') {
      setEstimate({ status: 'idle' });
      return;
    }
    setEstimate((current) => ({
      status: 'loading',
      data: current.status === 'ready' || current.status === 'loading' ? current.data : undefined,
    }));
    estimateTimer.current = setTimeout(() => {
      void callAction(estimateTransferAction, {
        ...recipientPayload(forDraft),
        amount: text,
      }).then((state) => {
        if (sequence !== estimateSeq.current) return; // a newer keystroke superseded this one
        setEstimate(
          state.ok && state.data
            ? { status: 'ready', data: state.data }
            : {
                status: 'error',
                message:
                  errorsOf(state).fields.amount ?? state.message ?? 'Could not price this amount',
              },
        );
      });
    }, 350);
  }

  function submitRecipient(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const state = await callAction(resolveRecipientAction, recipientPayload(draft));
      if (state.ok && state.data) {
        setResolved(state.data);
        setErrors(NO_ERRORS);
        setQuote(null);
        setStep('amount');
        runEstimate(amount, draft);
      } else {
        setErrors(errorsOf(state));
      }
    });
  }

  function lockQuote() {
    startTransition(async () => {
      const state = await callAction(lockQuoteAction, {
        ...recipientPayload(draft),
        amount,
        purpose,
        sourceOfFunds,
        note: note.trim(),
      });
      if (state.ok && state.data) {
        setQuote(state.data);
        setDeadline(Date.now() + state.data.ttlSeconds * 1000);
        setExpired(state.data.ttlSeconds <= 0);
        setErrors(NO_ERRORS);
        setStep('review');
      } else {
        setErrors(errorsOf(state));
      }
    });
  }

  function submitAmount(event: FormEvent) {
    event.preventDefault();
    lockQuote();
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!quote || expired) return;
    startTransition(async () => {
      const state = await callAction(confirmTransferAction, {
        ...recipientPayload(draft),
        amountMinor: quote.sendAmount,
        quoteId: quote.quoteId,
        idempotencyKey: quote.idempotencyKey,
        purpose: quote.purpose,
        sourceOfFunds: quote.sourceOfFunds,
        note: quote.note,
      });
      if (state.ok && state.data) {
        setResult(state.data);
        setErrors(NO_ERRORS);
        setStep('done');
      } else if (errorsOf(state).fields.quoteId) {
        // The server says the price is no longer valid (its clock is the one that counts).
        setExpired(true);
        setErrors(NO_ERRORS);
      } else {
        setErrors(errorsOf(state));
      }
    });
  }

  function startOver() {
    setDraft(blankDraft());
    setResolved(null);
    setAmount('');
    setPurpose('');
    setSourceOfFunds('');
    setNote('');
    setEstimate({ status: 'idle' });
    setQuote(null);
    setResult(null);
    setErrors(NO_ERRORS);
    setStep('recipient');
  }

  if (!wallet) return null;

  const title =
    step === 'recipient'
      ? 'Who are you sending to?'
      : step === 'amount'
        ? 'How much?'
        : step === 'review'
          ? 'Check and confirm'
          : 'Transfer submitted';
  const blocker = estimate.status === 'ready' ? estimate.data.blocker : null;
  const shownPrice =
    estimate.status === 'ready' || estimate.status === 'loading' ? estimate.data : undefined;
  const formMessage = errors.message ? (
    <Alert tone="danger">
      {errors.message}
      {/kyc|verify your identity/i.test(errors.message) ? (
        <>
          {' '}
          <Link href="/app/kyc" className="font-medium underline">
            Verify your identity
          </Link>
        </>
      ) : null}
    </Alert>
  ) : null;

  return (
    <div className="space-y-5">
      <Stepper current={step} />
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
        {title}
      </h2>

      {/* ------------------------------------------------------------ Step 1 */}
      {step === 'recipient' ? (
        <form onSubmit={submitRecipient} className="space-y-5" noValidate>
          {wallets.length > 1 ? (
            <Select
              name="senderWalletId"
              label="Send from"
              required
              value={draft.senderWalletId}
              onChange={(event) => update({ senderWalletId: event.target.value })}
              error={errors.fields.senderWalletId}
              options={wallets.map((option) => ({
                value: option.id,
                label: `${option.currency} wallet`,
              }))}
            />
          ) : null}
          <p className="text-sm text-fg-muted">
            From your {wallet.currency} wallet — available{' '}
            <Money
              amount={wallet.balance}
              currency={wallet.currency}
              className="font-medium text-fg"
            />
          </p>

          <RadioCards<SendScope>
            legend="Where is the money going?"
            name="scope"
            value={draft.scope}
            onChange={changeScope}
            error={errors.fields.scope}
            options={[
              {
                value: 'DOMESTIC',
                title: `Within ${home.name}`,
                description: 'Wallet, merchant, agent or mobile money',
              },
              {
                value: 'INTERNATIONAL',
                title: 'To another country',
                description: internationalAllowed
                  ? `${corridors.length} destinations, rate locked before you pay`
                  : 'Needs identity verification',
                disabled: !internationalAllowed || corridors.length === 0,
              },
            ]}
          />
          {internationalAllowed ? null : (
            <p className="text-sm text-fg-muted">
              International transfers open once your identity is verified.{' '}
              <Link href="/app/kyc" className="font-medium text-accent underline">
                Verify now
              </Link>
            </p>
          )}

          {international && draft.recipientType !== 'BENEFICIARY' ? (
            <Select
              name="targetCountry"
              label="Destination country"
              required
              placeholder="Choose a country"
              value={draft.targetCountry}
              onChange={(event) => update({ targetCountry: event.target.value, providerId: '' })}
              error={errors.fields.targetCountry}
              options={corridors.map((country) => ({
                value: country.code,
                label: `${country.name} (${country.currency})`,
              }))}
            />
          ) : null}

          <RadioCards<RecipientType>
            legend="Who are you paying?"
            name="recipientType"
            value={draft.recipientType}
            onChange={(recipientType) => update({ recipientType, identifier: '' })}
            error={errors.fields.recipientType}
            columns={3}
            options={typeOptions.map((type) => ({
              value: type,
              title: TYPE_COPY[type].title,
              description: international ? TYPE_COPY[type].international : TYPE_COPY[type].domestic,
            }))}
          />

          {draft.recipientType === 'PERSON' ? (
            <Input
              name="identifier"
              label="Phone number or e-mail"
              autoComplete="off"
              placeholder="+237 6 77 00 01 04 or name@example.com"
              required
              value={draft.identifier}
              onChange={(event) => update({ identifier: event.target.value })}
              error={errors.fields.identifier}
            />
          ) : null}
          {draft.recipientType === 'MERCHANT' || draft.recipientType === 'AGENT' ? (
            <Input
              name="identifier"
              label={draft.recipientType === 'MERCHANT' ? 'Merchant code' : 'Agent code'}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={draft.recipientType === 'MERCHANT' ? 'M-DEMO01' : 'A-DEMO01'}
              hint={
                draft.recipientType === 'MERCHANT'
                  ? 'Shown at the till or on the invoice'
                  : 'Shown at the agent’s counter'
              }
              required
              value={draft.identifier}
              onChange={(event) => update({ identifier: event.target.value })}
              error={errors.fields.identifier}
            />
          ) : null}
          {draft.recipientType === 'MOBILE_MONEY' ? (
            payoutProviders.length === 0 ? (
              <Alert tone="info">
                {international && !draft.targetCountry
                  ? 'Choose the destination country to see its mobile-money operators.'
                  : `No mobile-money operator is connected in ${international ? targetCountryName : home.name} yet. Send to a BI-Rem wallet instead.`}
              </Alert>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  name="providerId"
                  label="Mobile-money provider"
                  required
                  placeholder="Choose a provider"
                  value={draft.providerId}
                  onChange={(event) => update({ providerId: event.target.value })}
                  error={errors.fields.providerId}
                  options={payoutProviders.map((provider) => ({
                    value: provider.id,
                    label: provider.simulated ? `${provider.name} (simulated)` : provider.name,
                  }))}
                />
                <Input
                  name="accountNumber"
                  label="Mobile-money number"
                  inputMode="tel"
                  autoComplete="off"
                  required
                  value={draft.accountNumber}
                  onChange={(event) => update({ accountNumber: event.target.value })}
                  error={errors.fields.accountNumber}
                />
                <Input
                  name="recipientName"
                  label="Recipient’s full name"
                  autoComplete="off"
                  required
                  containerClassName="sm:col-span-2"
                  value={draft.recipientName}
                  onChange={(event) => update({ recipientName: event.target.value })}
                  error={errors.fields.recipientName}
                />
              </div>
            )
          ) : null}
          {draft.recipientType === 'BENEFICIARY' ? (
            scopedBeneficiaries.length === 0 ? (
              <Alert tone="info">
                You have no saved beneficiary {international ? 'abroad' : `in ${home.name}`}.{' '}
                <Link href="/app/beneficiaries" className="font-medium underline">
                  Add one
                </Link>
              </Alert>
            ) : (
              <Select
                name="beneficiaryId"
                label="Beneficiary"
                required
                placeholder="Choose a beneficiary"
                value={draft.beneficiaryId}
                onChange={(event) => update({ beneficiaryId: event.target.value })}
                error={errors.fields.beneficiaryId}
                options={scopedBeneficiaries.map((item) => ({ value: item.id, label: item.label }))}
              />
            )
          ) : null}

          {formMessage}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? 'Checking the recipient…' : 'Continue'}
            </Button>
          </div>
        </form>
      ) : null}

      {/* ------------------------------------------------------------ Step 2 */}
      {step === 'amount' && resolved ? (
        <form onSubmit={submitAmount} className="space-y-5" noValidate>
          <RecipientSummary resolved={resolved} />

          <Input
            name="amount"
            label={`You send (${resolved.senderCurrency})`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            required
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setErrors(NO_ERRORS);
              runEstimate(event.target.value, draft);
            }}
            error={errors.fields.amount}
            hint={
              <>
                Available: <Money amount={wallet.balance} currency={wallet.currency} />. The fee is
                added on top.
              </>
            }
          />

          <div
            aria-live="polite"
            aria-busy={estimate.status === 'loading' || undefined}
            className="rounded-lg border border-border px-4 py-2"
          >
            {shownPrice ? (
              <PriceLines price={shownPrice} dimmed={estimate.status === 'loading'} />
            ) : estimate.status === 'error' ? (
              <p className="py-2 text-sm text-danger">{estimate.message}</p>
            ) : (
              <p className="py-2 text-sm text-fg-muted">
                {estimate.status === 'loading'
                  ? 'Calculating the fee and rate…'
                  : 'Enter an amount to see the fee, the exchange rate and what the recipient gets.'}
              </p>
            )}
            {shownPrice ? (
              <p className="pb-1 text-xs text-fg-subtle">
                Estimate at current rates. The price is locked for you at the next step.
              </p>
            ) : null}
          </div>

          {blocker ? (
            <Alert
              tone="warning"
              title={
                blocker.code === 'INSUFFICIENT_FUNDS'
                  ? 'Not enough money in this wallet'
                  : blocker.code === 'KYC_REQUIRED'
                    ? 'Identity verification needed'
                    : 'Above your limit'
              }
            >
              {blocker.message}{' '}
              {blocker.code === 'INSUFFICIENT_FUNDS' ? (
                <Link
                  href={`/app/wallets/topup?wallet=${wallet.id}`}
                  className="font-medium underline"
                >
                  Top up
                </Link>
              ) : (
                <Link href="/app/kyc" className="font-medium underline">
                  {blocker.code === 'KYC_REQUIRED' ? 'Verify your identity' : 'See your limits'}
                </Link>
              )}
            </Alert>
          ) : null}

          {resolved.international ? (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-fg">
                Required for international transfers
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  name="purpose"
                  label="Purpose of the transfer"
                  required
                  placeholder="Choose a purpose"
                  value={purpose}
                  onChange={(event) => {
                    setPurpose(event.target.value);
                    setErrors(NO_ERRORS);
                  }}
                  error={errors.fields.purpose}
                  options={purposes.map((value) => ({
                    value,
                    label: labelFor(PURPOSE_LABELS, value),
                  }))}
                />
                <Select
                  name="sourceOfFunds"
                  label="Source of funds"
                  required
                  placeholder="Choose a source"
                  value={sourceOfFunds}
                  onChange={(event) => {
                    setSourceOfFunds(event.target.value);
                    setErrors(NO_ERRORS);
                  }}
                  error={errors.fields.sourceOfFunds}
                  options={sourcesOfFunds.map((value) => ({
                    value,
                    label: labelFor(SOURCE_OF_FUNDS_LABELS, value),
                  }))}
                />
              </div>
            </fieldset>
          ) : null}

          <Textarea
            name="note"
            label="Note for your records"
            rows={2}
            maxLength={140}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errors.fields.note}
          />

          {formMessage}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? 'Locking the price…' : 'Review transfer'}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setErrors(NO_ERRORS);
                setStep('recipient');
              }}
            >
              Back
            </Button>
          </div>
        </form>
      ) : null}

      {/* ------------------------------------------------------------ Step 3 */}
      {step === 'review' && quote ? (
        <form onSubmit={confirm} className="space-y-5">
          <RecipientSummary resolved={quote.plan} />
          <div className="rounded-lg border border-border px-4 py-2">
            <PriceLines price={quote} />
          </div>
          {quote.purpose || quote.sourceOfFunds || quote.note ? (
            <DescriptionList
              items={[
                ...(quote.purpose
                  ? [{ label: 'Purpose', value: labelFor(PURPOSE_LABELS, quote.purpose) }]
                  : []),
                ...(quote.sourceOfFunds
                  ? [
                      {
                        label: 'Source of funds',
                        value: labelFor(SOURCE_OF_FUNDS_LABELS, quote.sourceOfFunds),
                      },
                    ]
                  : []),
                ...(quote.note ? [{ label: 'Note', value: quote.note }] : []),
              ]}
            />
          ) : null}

          {expired ? (
            <Alert tone="warning" title="This price has expired">
              Rates may have moved. Get a new quote to continue — nothing has been debited.
            </Alert>
          ) : (
            <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-fg">
              {quote.rate ? 'Fee and exchange rate' : 'Fee'} locked for{' '}
              <Countdown
                key={quote.quoteId}
                deadline={deadline}
                initialSeconds={quote.ttlSeconds}
                onExpire={markExpired}
              />
              . Confirm before the time runs out to pay exactly this price.
            </p>
          )}
          {quote.plan.recipient.simulated ? (
            <p className="text-xs text-fg-subtle">
              {quote.plan.recipient.providerName} runs on the sandbox simulator: the payout to the
              mobile-money number is simulated, the debit of your BI-Rem wallet is real ledger money
              in this demonstration.
            </p>
          ) : null}

          {formMessage}
          <div className="flex flex-wrap gap-3">
            {expired || errors.message ? (
              <Button
                variant={expired ? 'primary' : 'secondary'}
                disabled={pending}
                onClick={lockQuote}
              >
                {pending ? 'Getting a new quote…' : 'Get a new quote'}
              </Button>
            ) : null}
            {expired ? null : (
              <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
                {pending ? 'Sending…' : 'Confirm and send'}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setErrors(NO_ERRORS);
                setStep('amount');
                runEstimate(amount, draft);
              }}
            >
              Back
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            By confirming you authorise BI-Rem Lite to debit{' '}
            <Money amount={quote.totalDebit} currency={quote.sourceCurrency} /> from your wallet.
            Confirming twice never sends twice.
          </p>
        </form>
      ) : null}

      {/* ------------------------------------------------------------ Step 4 */}
      {step === 'done' && result ? <Outcome result={result} onSendAnother={startOver} /> : null}
    </div>
  );
}

function Outcome({ result, onSendAnother }: { result: Result; onSendAnother: () => void }) {
  const outcome = describeOutcome({ ...result, perspective: 'SENDER' });
  return (
    <div className="space-y-4">
      <Alert tone={outcome.tone} title={outcome.title}>
        {outcome.body}
      </Alert>
      {result.replayed ? (
        <Alert tone="info">
          This confirmation had already been received — the transfer was not sent twice.
        </Alert>
      ) : null}
      <DescriptionList
        items={[
          { label: 'Reference', value: <span className="font-mono">{result.reference}</span> },
          { label: 'Status', value: <StatusBadge status={result.status} /> },
          { label: 'To', value: result.recipientName },
          {
            label: outcome.fundsReturned ? 'Amount (returned to your wallet)' : 'Total debited',
            value: <Money amount={result.totalDebit} currency={result.sourceCurrency} />,
          },
          {
            label: result.status === 'COMPLETED' ? 'Recipient got' : 'Recipient gets',
            value: <Money amount={result.receiveAmount} currency={result.targetCurrency} />,
          },
        ]}
      />
      <div className="flex flex-wrap gap-3">
        <LinkButton href={`/app/transfers/${result.id}`}>Track this transfer</LinkButton>
        {result.status === 'COMPLETED' ? (
          <LinkButton href={`/app/transfers/${result.id}/receipt`} variant="secondary">
            Receipt
          </LinkButton>
        ) : null}
        <Button variant="secondary" onClick={onSendAnother}>
          Send another
        </Button>
      </div>
    </div>
  );
}
