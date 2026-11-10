import type { ErrorCode } from '@/server/errors';

/**
 * Catalogue of the public API. One source for the human reference (`/partner/docs`), the
 * machine-readable description (`GET /api/v1/openapi.json`) and the API index (`GET /api/v1`),
 * so the three can never disagree. Pure data — safe to import anywhere.
 */

export type ApiScope = 'transfers:read' | 'transfers:write' | 'wallets:read' | 'quotes:write';

export interface ApiField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
}

export interface ApiEndpoint {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  /** Scope the API key needs; null = any valid key. */
  readonly scope: ApiScope | null;
  readonly pathParams?: readonly ApiField[];
  readonly query?: readonly ApiField[];
  readonly headers?: readonly ApiField[];
  readonly body?: { readonly fields: readonly ApiField[]; readonly example: unknown };
  /** Query string used in the curl example. */
  readonly exampleQuery?: string;
  /** Path with example values substituted, for the curl example. */
  readonly examplePath?: string;
  readonly successStatus: number;
  readonly responseExample: unknown;
  readonly errors: readonly ErrorCode[];
}

const RECIPIENT_FIELDS: readonly ApiField[] = [
  {
    name: 'recipient.type',
    type: '"wallet" | "mobile_money"',
    required: true,
    description: 'Where the money goes: a BI-Rem wallet or a mobile-money account.',
  },
  {
    name: 'recipient.identifier',
    type: 'string',
    required: false,
    description:
      'wallet only — phone (+237…), e-mail or partner code (M-…, A-…, P-…) of the BI-Rem account.',
  },
  {
    name: 'recipient.provider',
    type: 'string',
    required: false,
    description: 'mobile_money only — provider code from GET /api/v1/providers.',
  },
  {
    name: 'recipient.accountNumber',
    type: 'string',
    required: false,
    description: 'mobile_money only — the mobile-money number (8–20 characters).',
  },
  {
    name: 'recipient.name',
    type: 'string',
    required: false,
    description: 'mobile_money only — name of the account holder (screened before the debit).',
  },
];

const SOURCE_CURRENCY: ApiField = {
  name: 'sourceCurrency',
  type: 'string (ISO 4217)',
  required: false,
  description: 'Wallet to send from. Defaults to your home currency.',
};

const SENT_TRANSFER_EXAMPLE = {
  id: '5b1c7a0e-3c1e-4c69-9a55-0f3f0f6f8f21',
  reference: 'BRK7Q2M9XD4T',
  type: 'W2W',
  status: 'COMPLETED',
  direction: 'sent',
  deliveryMethod: 'WALLET',
  sourceCountry: 'CM',
  targetCountry: 'CM',
  sourceCurrency: 'XAF',
  targetCurrency: 'XAF',
  sendAmount: '25000',
  feeAmount: '125',
  totalDebit: '25125',
  receiveAmount: '25000',
  rate: '1',
  recipientName: 'Amina Nkemelu',
  recipientAccount: '+237699000101',
  purpose: null,
  sourceOfFunds: null,
  note: 'Invoice 2026-118',
  failureCode: null,
  failureReason: null,
  createdAt: '2026-11-10T09:14:03.120Z',
  completedAt: '2026-11-10T09:14:03.120Z',
  reversedAt: null,
};

export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  {
    id: 'me',
    method: 'GET',
    path: '/api/v1/me',
    summary: 'Who am I',
    description:
      'The partner this key acts for and the scopes it holds. Wallet balances are included when the key has wallets:read, otherwise wallets is null.',
    scope: null,
    successStatus: 200,
    responseExample: {
      data: {
        apiVersion: 'v1',
        partner: {
          id: '0d7f3f0a-6f5e-4b1e-9d0b-3a8b1f1f4c11',
          code: 'P-DEMO01',
          name: 'Demo Payouts',
          type: 'PARTNER',
          countryCode: 'CM',
          currency: 'XAF',
        },
        apiKey: {
          id: '9a0e1f8e-0f0b-4d57-8a3e-5a1f6d2c7b90',
          scopes: ['transfers:read', 'transfers:write', 'wallets:read', 'quotes:write'],
        },
        wallets: [
          {
            id: 'c1a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8',
            currency: 'XAF',
            balance: '4975000',
            status: 'ACTIVE',
          },
        ],
      },
    },
    errors: ['UNAUTHENTICATED', 'RATE_LIMITED'],
  },
  {
    id: 'providers',
    method: 'GET',
    path: '/api/v1/providers',
    summary: 'List mobile-money providers',
    description:
      'Providers a payout can be sent to. simulated: true means the sandbox simulator answers, not a live operator.',
    scope: null,
    query: [
      {
        name: 'country',
        type: 'string (ISO 3166-1 alpha-2)',
        required: false,
        description: 'Only providers of this country.',
      },
      {
        name: 'currency',
        type: 'string (ISO 4217)',
        required: false,
        description: 'Only providers paying out in this currency.',
      },
    ],
    exampleQuery: '?country=CM',
    successStatus: 200,
    responseExample: {
      data: [
        {
          code: 'mtn-momo-cm',
          name: 'MTN Mobile Money Cameroon',
          operator: 'MTN',
          countryCode: 'CM',
          currency: 'XAF',
          supportsPayout: true,
          supportsCollection: true,
          simulated: true,
        },
      ],
    },
    errors: ['VALIDATION', 'UNAUTHENTICATED', 'RATE_LIMITED'],
  },
  {
    id: 'rates',
    method: 'GET',
    path: '/api/v1/rates',
    summary: 'Indicative FX rates',
    description:
      'Mid rate and the rate a transfer would get today (mid less the margin) for a currency pair. Without to, every currency reachable from from. Indicative only — POST /api/v1/quotes locks a rate.',
    scope: null,
    query: [
      {
        name: 'from',
        type: 'string (ISO 4217)',
        required: true,
        description: 'Source currency.',
      },
      {
        name: 'to',
        type: 'string (ISO 4217)',
        required: false,
        description: 'Target currency. Omit to list all pairs.',
      },
    ],
    exampleQuery: '?from=XAF&to=AOA',
    successStatus: 200,
    responseExample: {
      data: {
        from: 'XAF',
        to: 'AOA',
        midRate: '1.5244',
        rate: '1.5015',
        marginBps: 150,
        source: 'seed',
        updatedAt: '2026-11-10T08:00:00.000Z',
      },
    },
    errors: ['VALIDATION', 'UNSUPPORTED', 'UNAUTHENTICATED', 'RATE_LIMITED'],
  },
  {
    id: 'quotes',
    method: 'POST',
    path: '/api/v1/quotes',
    summary: 'Create a quote',
    description:
      'Prices a transfer and locks the fee and FX rate for 15 minutes. No money moves. Pass quoteId to POST /api/v1/transfers to execute at exactly this price.',
    scope: 'quotes:write',
    body: {
      fields: [
        SOURCE_CURRENCY,
        ...RECIPIENT_FIELDS,
        {
          name: 'amount',
          type: 'string (minor units)',
          required: true,
          description:
            'Amount to send, in minor units of the source currency. The fee is added on top.',
        },
      ],
      example: {
        recipient: { type: 'wallet', identifier: 'joao@example.com' },
        amount: '100000',
      },
    },
    successStatus: 201,
    responseExample: {
      data: {
        quoteId: '7e0c8f5a-9d1b-4c7e-8a21-6f4d2b9c0e13',
        expiresAt: '2026-11-10T09:29:03.000Z',
        type: 'INTERNATIONAL',
        international: true,
        deliveryMethod: 'WALLET',
        sourceCountry: 'CM',
        targetCountry: 'AO',
        sourceCurrency: 'XAF',
        targetCurrency: 'AOA',
        sendAmount: '100000',
        feeAmount: '1501',
        totalDebit: '101501',
        receiveAmount: '15015000',
        rate: '1.5015',
        recipientName: 'João Baptista',
        recipientAccount: 'joao@example.com',
      },
    },
    errors: [
      'VALIDATION',
      'NOT_FOUND',
      'UNSUPPORTED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'RATE_LIMITED',
    ],
  },
  {
    id: 'create-transfer',
    method: 'POST',
    path: '/api/v1/transfers',
    summary: 'Send a transfer',
    description:
      'Debits your wallet and delivers to a BI-Rem wallet (immediately) or a mobile-money account (asynchronously). A wallet delivery returns COMPLETED; a mobile-money payout returns PROCESSING and ends COMPLETED or FAILED (refunded) — follow it with webhooks or GET /api/v1/transfers/{reference}. A transfer flagged by AML screening returns ON_HOLD with the funds reserved until compliance releases or rejects it. International transfers need purpose and sourceOfFunds.',
    scope: 'transfers:write',
    headers: [
      {
        name: 'Idempotency-Key',
        type: 'string',
        required: true,
        description:
          '8–100 characters (A-Z a-z 0-9 _ . : -), unique per transfer. Repeating a request with the same key returns the original transfer (200, Idempotent-Replayed: true) and never debits twice; reusing it for another amount or recipient returns 409.',
      },
    ],
    body: {
      fields: [
        SOURCE_CURRENCY,
        ...RECIPIENT_FIELDS,
        {
          name: 'amount',
          type: 'string (minor units)',
          required: false,
          description: 'Amount to send. Required unless quoteId is given.',
        },
        {
          name: 'quoteId',
          type: 'string (uuid)',
          required: false,
          description: 'A quote from POST /api/v1/quotes; executes at the locked price.',
        },
        {
          name: 'purpose',
          type: 'string',
          required: false,
          description:
            'Required for international transfers: FAMILY_SUPPORT, EDUCATION, MEDICAL, GOODS_AND_SERVICES, SALARY, RENT, SAVINGS, GIFT, BUSINESS or OTHER.',
        },
        {
          name: 'sourceOfFunds',
          type: 'string',
          required: false,
          description:
            'Required for international transfers: SALARY, BUSINESS_INCOME, SAVINGS, FAMILY, INVESTMENT, LOAN or OTHER.',
        },
        {
          name: 'note',
          type: 'string',
          required: false,
          description: 'Free text shown to the recipient (≤ 140 characters).',
        },
      ],
      example: {
        recipient: { type: 'wallet', identifier: '+237699000101' },
        amount: '25000',
        note: 'Invoice 2026-118',
      },
    },
    successStatus: 201,
    responseExample: { data: SENT_TRANSFER_EXAMPLE },
    errors: [
      'VALIDATION',
      'NOT_FOUND',
      'CONFLICT',
      'INSUFFICIENT_FUNDS',
      'QUOTE_EXPIRED',
      'UNSUPPORTED',
      'PROVIDER_ERROR',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'RATE_LIMITED',
    ],
  },
  {
    id: 'list-transfers',
    method: 'GET',
    path: '/api/v1/transfers',
    summary: 'List transfers',
    description:
      'Your transfers, newest first: the ones you sent (any status) and payments you received (completed or reversed).',
    scope: 'transfers:read',
    query: [
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'PROCESSING, ON_HOLD, COMPLETED, FAILED, REJECTED or REVERSED.',
      },
      {
        name: 'type',
        type: 'string',
        required: false,
        description: 'W2W, W2M, W2A, INTERNATIONAL or TOPUP.',
      },
      {
        name: 'direction',
        type: '"sent" | "received"',
        required: false,
        description: 'Only one side. Default: both.',
      },
      {
        name: 'from',
        type: 'string (ISO 8601)',
        required: false,
        description: 'Created at or after this date / date-time.',
      },
      {
        name: 'to',
        type: 'string (ISO 8601)',
        required: false,
        description: 'Created at or before this date / date-time.',
      },
      { name: 'page', type: 'integer', required: false, description: 'Page number, from 1.' },
      {
        name: 'pageSize',
        type: 'integer',
        required: false,
        description: 'Items per page, 1–100 (default 20).',
      },
    ],
    exampleQuery: '?status=COMPLETED&pageSize=2',
    successStatus: 200,
    responseExample: {
      data: [
        {
          id: '5b1c7a0e-3c1e-4c69-9a55-0f3f0f6f8f21',
          reference: 'BRK7Q2M9XD4T',
          type: 'W2W',
          status: 'COMPLETED',
          direction: 'sent',
          deliveryMethod: 'WALLET',
          counterpartyName: 'Amina Nkemelu',
          counterpartyAccount: '+237699000101',
          amount: '25125',
          currency: 'XAF',
          sendAmount: '25000',
          sourceCurrency: 'XAF',
          receiveAmount: '25000',
          targetCurrency: 'XAF',
          feeAmount: '125',
          createdAt: '2026-11-10T09:14:03.120Z',
          completedAt: '2026-11-10T09:14:03.120Z',
        },
      ],
      pagination: { page: 1, pageSize: 2, total: 37, pages: 19 },
    },
    errors: ['VALIDATION', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED'],
  },
  {
    id: 'get-transfer',
    method: 'GET',
    path: '/api/v1/transfers/{reference}',
    summary: 'Get a transfer',
    description:
      'One transfer by reference (or id) with its timeline. A transfer that is not yours is a 404.',
    scope: 'transfers:read',
    pathParams: [
      {
        name: 'reference',
        type: 'string',
        required: true,
        description: 'Transfer reference (BR…) or id (uuid).',
      },
    ],
    examplePath: '/api/v1/transfers/BRK7Q2M9XD4T',
    successStatus: 200,
    responseExample: {
      data: {
        ...SENT_TRANSFER_EXAMPLE,
        provider: null,
        timeline: [
          {
            type: 'CREATED',
            message: 'Transfer created',
            createdAt: '2026-11-10T09:14:03.120Z',
          },
          {
            type: 'COMPLETED',
            message: 'Delivered to the recipient wallet',
            createdAt: '2026-11-10T09:14:03.120Z',
          },
        ],
      },
    },
    errors: ['NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED'],
  },
  {
    id: 'refresh-transfer',
    method: 'POST',
    path: '/api/v1/transfers/{reference}/refresh',
    summary: 'Refresh a pending payout',
    description:
      'Asks the mobile-money provider for the current status of a PROCESSING payout you sent and applies it. Safe to repeat; a transfer that is no longer PROCESSING is returned unchanged. Prefer webhooks.',
    scope: 'transfers:write',
    pathParams: [
      {
        name: 'reference',
        type: 'string',
        required: true,
        description: 'Transfer reference (BR…) or id (uuid).',
      },
    ],
    examplePath: '/api/v1/transfers/BRK7Q2M9XD4T/refresh',
    successStatus: 200,
    responseExample: {
      data: {
        ...SENT_TRANSFER_EXAMPLE,
        type: 'W2W',
        deliveryMethod: 'MOBILE_MONEY',
        recipientAccount: '237677000003',
        provider: { code: 'mtn-momo-cm', name: 'MTN Mobile Money Cameroon', simulated: true },
        timeline: [],
      },
    },
    errors: ['NOT_FOUND', 'PROVIDER_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED'],
  },
];

export const API_ERRORS: ReadonlyArray<{
  readonly code: ErrorCode;
  readonly status: number;
  readonly meaning: string;
}> = [
  { code: 'VALIDATION', status: 400, meaning: 'The request is malformed; see errors per field.' },
  { code: 'UNAUTHENTICATED', status: 401, meaning: 'Missing, unknown or revoked API key.' },
  { code: 'FORBIDDEN', status: 403, meaning: 'The key lacks the scope this endpoint needs.' },
  { code: 'NOT_FOUND', status: 404, meaning: 'No such object — or it is not yours.' },
  {
    code: 'CONFLICT',
    status: 409,
    meaning: 'Idempotency-Key reused for a different request, or a duplicate.',
  },
  {
    code: 'INVALID_STATE',
    status: 409,
    meaning: 'The object is not in a state that allows this.',
  },
  {
    code: 'INSUFFICIENT_FUNDS',
    status: 422,
    meaning: 'The wallet balance does not cover amount + fee (available / required are given).',
  },
  { code: 'LIMIT_EXCEEDED', status: 422, meaning: 'A transaction limit would be exceeded.' },
  { code: 'QUOTE_EXPIRED', status: 422, meaning: 'The quote is older than 15 minutes or used.' },
  {
    code: 'UNSUPPORTED',
    status: 422,
    meaning: 'Country, corridor, currency pair or provider is not available.',
  },
  {
    code: 'RATE_LIMITED',
    status: 429,
    meaning: '120 requests per minute per key; wait for Retry-After seconds.',
  },
  {
    code: 'PROVIDER_ERROR',
    status: 502,
    meaning: 'The mobile-money provider could not be reached; retry later.',
  },
  {
    code: 'INTERNAL',
    status: 500,
    meaning: 'Unexpected error on our side; retry with the same key.',
  },
];

export const PROBLEM_EXAMPLE = {
  type: 'urn:bi-rem:problem:insufficient-funds',
  title: 'Insufficient funds',
  status: 422,
  detail: 'Insufficient funds: 12 000 XAF available, 25 125 XAF needed',
  code: 'INSUFFICIENT_FUNDS',
  instance: '/api/v1/transfers',
  requestId: '0f6c1b7e-0a55-4a07-9a3c-9d1c5f0e7a42',
  available: '12000',
  required: '25125',
};

export const WEBHOOK_EVENTS: ReadonlyArray<{ readonly type: string; readonly when: string }> = [
  { type: 'transfer.completed', when: 'A transfer you sent was delivered.' },
  { type: 'transfer.failed', when: 'A payout you sent failed at the provider; you were refunded.' },
  { type: 'transfer.on_hold', when: 'A transfer you sent is held for compliance review.' },
  { type: 'transfer.rejected', when: 'A held transfer was rejected; you were refunded.' },
  { type: 'transfer.reversed', when: 'A completed transfer you sent was reversed.' },
  { type: 'payment.received', when: 'A payment arrived in your wallet.' },
  { type: 'payment.reversed', when: 'A payment you received was reversed.' },
  { type: 'settlement.paid', when: 'Accrued commission was paid into your wallet.' },
  { type: 'webhook.test', when: 'You pressed "Send test event" in the portal.' },
];

export const WEBHOOK_PAYLOAD_EXAMPLE = {
  id: '3c2f5d1e-8a4b-4f6c-9d7e-1a2b3c4d5e6f',
  type: 'transfer.completed',
  createdAt: '2026-11-10T09:14:04.512Z',
  data: {
    id: '5b1c7a0e-3c1e-4c69-9a55-0f3f0f6f8f21',
    reference: 'BRK7Q2M9XD4T',
    type: 'W2W',
    status: 'COMPLETED',
    sourceCurrency: 'XAF',
    targetCurrency: 'XAF',
    sendAmount: '25000',
    feeAmount: '125',
    receiveAmount: '25000',
    recipientName: 'Amina Nkemelu',
    recipientAccount: '+237699000101',
    failureCode: null,
    createdAt: '2026-11-10T09:14:03.120Z',
    completedAt: '2026-11-10T09:14:03.120Z',
  },
};
