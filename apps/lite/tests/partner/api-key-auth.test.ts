import { afterEach, describe, expect, it } from 'vitest';

import { GET as getMe } from '@/app/api/v1/me/route';
import { GET as getProviders } from '@/app/api/v1/providers/route';
import { POST as postQuote } from '@/app/api/v1/quotes/route';
import { GET as getRates } from '@/app/api/v1/rates/route';
import { GET as getTransfer } from '@/app/api/v1/transfers/[reference]/route';
import { GET as listTransfers, POST as postTransfer } from '@/app/api/v1/transfers/route';
import { hashToken } from '@/server/crypto';
import { db } from '@/server/db';
import {
  type ApiKeyScope,
  assertApiScope,
  authenticateApiKey,
  createApiKey,
  revokeApiKey,
  updatePartner,
} from '@/server/partners';
import { createTransfer } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  type TestPartner,
  createCustomer,
  createPartner,
  createStaff,
  idem,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

const ALL_SCOPES: ApiKeyScope[] = [
  'transfers:read',
  'transfers:write',
  'wallets:read',
  'quotes:write',
];
const BASE = 'http://lite.test/api/v1';
const noParams = { params: Promise.resolve({}) as Promise<Record<string, never>> };

async function keyFor(partner: TestPartner, scopes: ApiKeyScope[] = ALL_SCOPES) {
  const { apiKey, secret } = await createApiKey(partner.ctx, { name: 'test key', scopes });
  return { id: apiKey.id, secret, bearer: `Bearer ${secret}` };
}

const request = (
  path: string,
  init: { method?: string; bearer?: string; headers?: Record<string, string>; body?: unknown } = {},
): Request =>
  new Request(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.bearer ? { authorization: init.bearer } : {}),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
}

async function problemOf(response: Response): Promise<Problem> {
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return (await response.json()) as Problem;
}

describe('API key authentication (service)', () => {
  it('stores only a hash and authenticates the key it issued', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    const key = await keyFor(partner, ['transfers:read']);
    expect(key.secret).toMatch(/^brl_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}$/);

    const row = await db.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.keyHash).toBe(hashToken(key.secret));
    expect(JSON.stringify(row)).not.toContain(key.secret);
    // The audit trail of the creation must not contain the key either.
    const audit = await db.auditLog.findMany({ where: { resourceId: key.id } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(key.secret);

    const auth = await authenticateApiKey(key.bearer);
    expect(auth.partner.id).toBe(partner.id);
    expect(auth.ctx.actor).toMatchObject({ type: 'API_KEY', id: key.id, partnerId: partner.id });
    expect(auth.scopes).toEqual(['transfers:read']);
    expect(() => assertApiScope(auth, 'transfers:read')).not.toThrow();
    expect(() => assertApiScope(auth, 'transfers:write')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it.each([
    ['no header', null],
    ['empty header', ''],
    ['not a bearer token', 'Basic dXNlcjpwYXNz'],
    ['bearer without a key', 'Bearer '],
    ['wrong key shape', 'Bearer fake_other_vendor_1234567890abcdef1234567890'],
    ['well-formed but unknown key', `Bearer brl_abcdefgh_${'A'.repeat(43)}`],
  ])('rejects %s', async (_label, header) => {
    await expect(authenticateApiKey(header)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a key that differs by one character, and a revoked key', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    const key = await keyFor(partner);
    const last = key.secret.at(-1) === 'A' ? 'B' : 'A';
    await expect(
      authenticateApiKey(`Bearer ${key.secret.slice(0, -1)}${last}`),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(authenticateApiKey(key.bearer)).resolves.toBeDefined();
    await revokeApiKey(partner.ctx, key.id);
    await expect(authenticateApiKey(key.bearer)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('disables every key of a suspended partner, and restores them on reactivation', async () => {
    const admin = await createStaff('ADMIN');
    const partner = await createPartner({ type: 'PARTNER' });
    const key = await keyFor(partner);
    await updatePartner(admin.ctx, partner.id, { status: 'SUSPENDED' });
    await expect(authenticateApiKey(key.bearer)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await updatePartner(admin.ctx, partner.id, { status: 'ACTIVE' });
    await expect(authenticateApiKey(key.bearer)).resolves.toBeDefined();
  });

  it("one partner cannot revoke another partner's key", async () => {
    const owner = await createPartner({ type: 'PARTNER' });
    const other = await createPartner({ type: 'PARTNER' });
    const key = await keyFor(owner);
    await expect(revokeApiKey(other.ctx, key.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(authenticateApiKey(key.bearer)).resolves.toBeDefined();
  });

  describe('per-key rate limit', () => {
    afterEach(() => {
      delete process.env.RATE_LIMIT_STRICT;
    });

    it('allows 120 requests per minute per key, then answers RATE_LIMITED', async () => {
      process.env.RATE_LIMIT_STRICT = '1';
      const partner = await createPartner({ type: 'PARTNER' });
      const limitedKey = await keyFor(partner);
      const other = await keyFor(partner);
      // Pin the bucket to its ceiling instead of making 120 calls. The limiter uses fixed
      // one-minute windows, so if the clock crosses a window boundary between the pin and the
      // call the count legitimately restarts — pin again and repeat once.
      const whenAtCeiling = async <T>(call: () => Promise<T>, limited: (value: T) => boolean) => {
        let result: T | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await authenticateApiKey(other.bearer); // keeps `other` warm, unrelated bucket
          await db.rateLimitBucket.upsert({
            where: { key: `api:key:${limitedKey.id}` },
            update: { count: 120 },
            create: {
              key: `api:key:${limitedKey.id}`,
              count: 120,
              windowStart: new Date(Math.floor(Date.now() / 60_000) * 60_000),
              expiresAt: new Date(Math.floor(Date.now() / 60_000) * 60_000 + 60_000),
            },
          });
          result = await call();
          if (limited(result)) break;
        }
        return result as T;
      };
      await authenticateApiKey(limitedKey.bearer);
      const error = await whenAtCeiling(
        () =>
          authenticateApiKey(limitedKey.bearer).then(
            () => null,
            (cause: unknown) => cause,
          ),
        (value) => value !== null,
      );
      expect(error).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) as number },
      });
      // The limit is per key: another key of the same partner is unaffected.
      await expect(authenticateApiKey(other.bearer)).resolves.toBeDefined();

      const response = await whenAtCeiling(
        () => getMe(request('/me', { bearer: limitedKey.bearer }), noParams),
        (value) => value.status === 429,
      );
      expect(response.status).toBe(429);
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await problemOf(response)).code).toBe('RATE_LIMITED');
    });
  });
});

describe('public API routes', () => {
  it('answers 401 problem+json without or with a bad key, on every route', async () => {
    const calls: Array<() => Promise<Response>> = [
      () => getMe(request('/me'), noParams),
      () => getProviders(request('/providers'), noParams),
      () => getRates(request('/rates?from=XAF&to=AOA'), noParams),
      () => listTransfers(request('/transfers'), noParams),
      () =>
        getTransfer(request('/transfers/BRAAAAAAAAAA'), {
          params: Promise.resolve({ reference: 'BRAAAAAAAAAA' }),
        }),
      () => postQuote(request('/quotes', { method: 'POST', body: {} }), noParams),
      () =>
        postTransfer(
          request('/transfers', {
            method: 'POST',
            body: {},
            bearer: `Bearer brl_abcdefgh_${'A'.repeat(43)}`,
            headers: { 'idempotency-key': 'never-used-key-1' },
          }),
          noParams,
        ),
    ];
    for (const call of calls) {
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Bearer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const problem = await problemOf(response);
      expect(problem).toMatchObject({
        type: 'urn:bi-rem:problem:unauthenticated',
        status: 401,
        code: 'UNAUTHENTICATED',
      });
      expect(problem.instance).toMatch(/^\/api\/v1\//);
      expect(problem.requestId).toBeTruthy();
    }
  });

  it('GET /me reports the partner; wallets only with wallets:read', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 80_000n });
    const full = await keyFor(partner);
    const narrow = await keyFor(partner, ['transfers:read']);

    const withWallets = (await (
      await getMe(request('/me', { bearer: full.bearer }), noParams)
    ).json()) as {
      data: {
        partner: { code: string };
        wallets: Array<{ balance: string; currency: string }> | null;
      };
    };
    expect(withWallets.data.partner.code).toBe(partner.code);
    expect(withWallets.data.wallets).toEqual([
      expect.objectContaining({ currency: 'XAF', balance: '80000' }),
    ]);

    const without = (await (
      await getMe(request('/me', { bearer: narrow.bearer }), noParams)
    ).json()) as {
      data: { wallets: unknown };
    };
    expect(without.data.wallets).toBeNull();
  });

  it('echoes a caller-supplied x-request-id', async () => {
    const partner = await createPartner({ type: 'PARTNER' });
    const key = await keyFor(partner);
    const response = await getMe(
      request('/me', { bearer: key.bearer, headers: { 'x-request-id': 'trace-abc-12345' } }),
      noParams,
    );
    expect(response.headers.get('x-request-id')).toBe('trace-abc-12345');
  });

  it('enforces scopes with 403', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 50_000n });
    const customer = await createCustomer();
    const readOnly = await keyFor(partner, ['transfers:read']);
    const response = await postTransfer(
      request('/transfers', {
        method: 'POST',
        bearer: readOnly.bearer,
        headers: { 'idempotency-key': idem('scope') },
        body: { recipient: { type: 'wallet', identifier: customer.phone }, amount: '1000' },
      }),
      noParams,
    );
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('FORBIDDEN');
    expect(await walletBalance(partner.walletId)).toBe(50_000n);

    const quote = await postQuote(
      request('/quotes', {
        method: 'POST',
        bearer: readOnly.bearer,
        body: { recipient: { type: 'wallet', identifier: customer.phone }, amount: '1000' },
      }),
      noParams,
    );
    expect(quote.status).toBe(403);
  });

  it('POST /transfers requires a valid Idempotency-Key and integer minor units', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 50_000n });
    const customer = await createCustomer();
    const key = await keyFor(partner);
    const body = { recipient: { type: 'wallet', identifier: customer.phone }, amount: '1000' };

    const missing = await postTransfer(
      request('/transfers', { method: 'POST', bearer: key.bearer, body }),
      noParams,
    );
    expect(missing.status).toBe(400);
    expect((await problemOf(missing)).errors).toHaveProperty('Idempotency-Key');

    const malformed = await postTransfer(
      request('/transfers', {
        method: 'POST',
        bearer: key.bearer,
        headers: { 'idempotency-key': 'short' },
        body,
      }),
      noParams,
    );
    expect(malformed.status).toBe(400);

    for (const amount of [10.5, '10.5', '-5', '0', 'abc', 1e21]) {
      const response = await postTransfer(
        request('/transfers', {
          method: 'POST',
          bearer: key.bearer,
          headers: { 'idempotency-key': idem('amount') },
          body: { ...body, amount },
        }),
        noParams,
      );
      expect(response.status, `amount ${String(amount)}`).toBe(400);
      expect((await problemOf(response)).errors).toHaveProperty('amount');
    }

    const unknownField = await postTransfer(
      request('/transfers', {
        method: 'POST',
        bearer: key.bearer,
        headers: { 'idempotency-key': idem('extra') },
        body: { ...body, senderWalletId: '00000000-0000-4000-8000-000000000000' },
      }),
      noParams,
    );
    expect(unknownField.status).toBe(400);

    const notJson = await postTransfer(
      new Request(`${BASE}/transfers`, {
        method: 'POST',
        headers: { authorization: key.bearer, 'idempotency-key': idem('json') },
        body: '{not json',
      }),
      noParams,
    );
    expect(notJson.status).toBe(400);
    expect(await walletBalance(partner.walletId)).toBe(50_000n);
  });

  it('sends once, replays idempotently and refuses a reused key for a different request', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 100_000n });
    const customer = await createCustomer();
    const key = await keyFor(partner);
    const idempotencyKey = idem('api');
    const send = (amount: string) =>
      postTransfer(
        request('/transfers', {
          method: 'POST',
          bearer: key.bearer,
          headers: { 'idempotency-key': idempotencyKey },
          body: {
            recipient: { type: 'wallet', identifier: customer.phone },
            amount,
            note: 'INV-1',
          },
        }),
        noParams,
      );

    const first = await send('20000');
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBe('false');
    const created = (await first.json()) as {
      data: {
        id: string;
        reference: string;
        status: string;
        sendAmount: string;
        totalDebit: string;
      };
    };
    expect(created.data).toMatchObject({ status: 'COMPLETED', sendAmount: '20000' });
    expect(first.headers.get('location')).toBe(`/api/v1/transfers/${created.data.reference}`);
    const afterFirst = await walletBalance(partner.walletId);
    expect(afterFirst).toBe(100_000n - BigInt(created.data.totalDebit));
    expect(await walletBalance(customer.walletId)).toBe(20_000n);

    const replay = await send('20000');
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(((await replay.json()) as typeof created).data.id).toBe(created.data.id);

    const different = await send('30000');
    expect(different.status).toBe(409);
    expect((await problemOf(different)).code).toBe('CONFLICT');

    // Neither the replay nor the conflicting request moved any money.
    expect(await walletBalance(partner.walletId)).toBe(afterFirst);
    expect(await walletBalance(customer.walletId)).toBe(20_000n);
    expect(await db.transfer.count({ where: { senderPartnerId: partner.id } })).toBe(1);

    const stored = await db.transfer.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(stored.channel).toBe('API');
  });

  it('reports insufficient funds as a 422 problem with the amounts', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 500n });
    const customer = await createCustomer();
    const key = await keyFor(partner);
    const response = await postTransfer(
      request('/transfers', {
        method: 'POST',
        bearer: key.bearer,
        headers: { 'idempotency-key': idem('poor') },
        body: { recipient: { type: 'wallet', identifier: customer.phone }, amount: '5000' },
      }),
      noParams,
    );
    expect(response.status).toBe(422);
    const problem = (await problemOf(response)) as Problem & {
      available?: string;
      required?: string;
    };
    expect(problem.code).toBe('INSUFFICIENT_FUNDS');
    expect(problem.available).toBe('500');
    expect(BigInt(problem.required ?? '0')).toBeGreaterThan(5000n);
    expect(await walletBalance(partner.walletId)).toBe(500n);
  });

  it("scopes reads to the key's partner: another partner's transfer is a 404", async () => {
    const alpha = await createPartner({ type: 'PARTNER', balance: 60_000n });
    const beta = await createPartner({ type: 'PARTNER', balance: 60_000n });
    const customer = await createCustomer();
    const { transfer } = await createTransfer(alpha.ctx, {
      senderWalletId: alpha.walletId,
      recipient: { kind: 'WALLET', identifier: customer.phone },
      amount: 7_000n,
      idempotencyKey: idem('alpha'),
    });
    const alphaKey = await keyFor(alpha);
    const betaKey = await keyFor(beta);
    const params = { params: Promise.resolve({ reference: transfer.reference }) };

    const own = await getTransfer(
      request(`/transfers/${transfer.reference}`, { bearer: alphaKey.bearer }),
      params,
    );
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as {
      data: { reference: string; direction: string; timeline: unknown[] };
    };
    expect(ownBody.data).toMatchObject({ reference: transfer.reference, direction: 'sent' });
    expect(ownBody.data.timeline.length).toBeGreaterThan(0);

    const foreign = await getTransfer(
      request(`/transfers/${transfer.reference}`, { bearer: betaKey.bearer }),
      params,
    );
    expect(foreign.status).toBe(404);
    expect((await problemOf(foreign)).code).toBe('NOT_FOUND');
    const byId = await getTransfer(
      request(`/transfers/${transfer.id}`, { bearer: betaKey.bearer }),
      {
        params: Promise.resolve({ reference: transfer.id }),
      },
    );
    expect(byId.status).toBe(404);

    const betaList = (await (
      await listTransfers(request('/transfers', { bearer: betaKey.bearer }), noParams)
    ).json()) as { data: unknown[]; pagination: { total: number } };
    expect(betaList.data).toEqual([]);
    expect(betaList.pagination.total).toBe(0);
    const alphaList = (await (
      await listTransfers(
        request('/transfers?direction=sent', { bearer: alphaKey.bearer }),
        noParams,
      )
    ).json()) as { data: Array<{ reference: string }> };
    expect(alphaList.data.map((item) => item.reference)).toEqual([transfer.reference]);
  });

  it('lists payments a merchant received from customers, without the sender’s fee', async () => {
    const merchant = await createPartner({ type: 'MERCHANT' });
    const customer = await createCustomer({ balance: 50_000n });
    const { transfer } = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 9_000n,
      idempotencyKey: idem('pay'),
    });
    const key = await keyFor(merchant, ['transfers:read']);
    const list = (await (
      await listTransfers(
        request('/transfers?direction=received', { bearer: key.bearer }),
        noParams,
      )
    ).json()) as {
      data: Array<{
        reference: string;
        direction: string;
        amount: string;
        feeAmount: string | null;
      }>;
    };
    expect(list.data).toEqual([
      expect.objectContaining({
        reference: transfer.reference,
        direction: 'received',
        amount: '9000',
        feeAmount: null,
      }),
    ]);
    const detail = (await (
      await getTransfer(request(`/transfers/${transfer.reference}`, { bearer: key.bearer }), {
        params: Promise.resolve({ reference: transfer.reference }),
      })
    ).json()) as { data: Record<string, unknown> };
    expect(detail.data).toMatchObject({ direction: 'received', receiveAmount: '9000' });
    expect(detail.data).not.toHaveProperty('feeAmount');
    expect(detail.data).not.toHaveProperty('totalDebit');
  });

  it('validates query parameters and prices quotes', async () => {
    const partner = await createPartner({ type: 'PARTNER', balance: 500_000n });
    const abroad = await createCustomer({ country: 'AO' });
    const key = await keyFor(partner);

    const badList = await listTransfers(
      request('/transfers?status=DONE&pageSize=1000', { bearer: key.bearer }),
      noParams,
    );
    expect(badList.status).toBe(400);
    expect(Object.keys((await problemOf(badList)).errors ?? {}).sort()).toEqual([
      'pageSize',
      'status',
    ]);

    const badRate = await getRates(request('/rates?from=XYZ', { bearer: key.bearer }), noParams);
    expect(badRate.status).toBe(400);
    const rate = (await (
      await getRates(request('/rates?from=xaf&to=AOA', { bearer: key.bearer }), noParams)
    ).json()) as {
      data: { from: string; to: string; midRate: string; rate: string; marginBps: number };
    };
    expect(rate.data).toMatchObject({ from: 'XAF', to: 'AOA' });
    expect(rate.data.midRate).toMatch(/^\d+(\.\d+)?$/);
    expect(rate.data.rate).toMatch(/^\d+(\.\d+)?$/);

    const quote = await postQuote(
      request('/quotes', {
        method: 'POST',
        bearer: key.bearer,
        body: { recipient: { type: 'wallet', identifier: abroad.email }, amount: '100000' },
      }),
      noParams,
    );
    expect(quote.status).toBe(201);
    const quoted = (await quote.json()) as {
      data: {
        quoteId: string;
        international: boolean;
        totalDebit: string;
        sendAmount: string;
        feeAmount: string;
      };
    };
    expect(quoted.data.international).toBe(true);
    expect(BigInt(quoted.data.totalDebit)).toBe(
      BigInt(quoted.data.sendAmount) + BigInt(quoted.data.feeAmount),
    );
    // A quote moves no money.
    expect(await walletBalance(partner.walletId)).toBe(500_000n);

    const providers = (await (
      await getProviders(request('/providers?country=cm', { bearer: key.bearer }), noParams)
    ).json()) as { data: Array<{ code: string; countryCode: string; simulated: boolean }> };
    expect(providers.data.length).toBeGreaterThan(0);
    expect(
      providers.data.every((provider) => provider.countryCode === 'CM' && provider.simulated),
    ).toBe(true);
    expect(JSON.stringify(providers.data)).not.toMatch(/secret|credential|baseUrl/i);
  });
});
