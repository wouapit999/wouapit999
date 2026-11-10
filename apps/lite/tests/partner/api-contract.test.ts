import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOpenApiDocument } from '@/app/api/v1/_lib/openapi';
import { PROBLEM_TITLES, problemType, toProblem } from '@/app/api/v1/_lib/problem';
import { API_ENDPOINTS, API_ERRORS, WEBHOOK_EVENTS } from '@/app/api/v1/_lib/reference';
import {
  minorAmountSchema,
  quoteBodySchema,
  recipientSchema,
  transferBodySchema,
  transferListQuerySchema,
} from '@/app/api/v1/_lib/schemas';
import { getBuildInfo } from '@/app/status/build-info';
import { AppError, ERROR_STATUS, type ErrorCode } from '@/server/errors';
import { API_KEY_SCOPES, PARTNER_EVENT_TYPES } from '@/server/partners';

const appPath = (relative: string): string =>
  fileURLToPath(new URL(`../../src/app${relative}`, import.meta.url));

describe('problem details (RFC 9457)', () => {
  it('maps every AppError code to its status, type and title', () => {
    for (const code of Object.keys(ERROR_STATUS) as ErrorCode[]) {
      const problem = toProblem(new AppError(code, `detail for ${code}`), {
        instance: '/api/v1/transfers',
        requestId: 'req-12345678',
      });
      expect(problem.status).toBe(ERROR_STATUS[code]);
      expect(problem.body).toMatchObject({
        type: problemType(code),
        title: PROBLEM_TITLES[code],
        status: ERROR_STATUS[code],
        detail: `detail for ${code}`,
        code,
        instance: '/api/v1/transfers',
        requestId: 'req-12345678',
      });
    }
    expect(problemType('INSUFFICIENT_FUNDS')).toBe('urn:bi-rem:problem:insufficient-funds');
  });

  it('adds Retry-After, WWW-Authenticate and field errors where they apply', () => {
    const limited = toProblem(
      new AppError('RATE_LIMITED', 'slow down', { details: { retryAfterSeconds: 41.2 } }),
    );
    expect(limited.headers['retry-after']).toBe('42');
    expect(limited.body.retryAfterSeconds).toBe(42);
    expect(toProblem(new AppError('UNAUTHENTICATED', 'no')).headers['www-authenticate']).toContain(
      'Bearer',
    );
    const invalid = toProblem(
      new AppError('VALIDATION', 'bad', { fieldErrors: { amount: ['Too small'] } }),
    );
    expect(invalid.body.errors).toEqual({ amount: ['Too small'] });
    const funds = toProblem(
      new AppError('INSUFFICIENT_FUNDS', 'no money', {
        details: { available: '500', required: '5025', internal: 'never shown' },
      }),
    );
    expect(funds.body).toMatchObject({ available: '500', required: '5025' });
    expect(JSON.stringify(funds.body)).not.toContain('never shown');
  });

  it('turns a ZodError into a 400 with one entry per field', () => {
    const result = z
      .object({ amount: z.string(), recipient: z.object({ type: z.string() }) })
      .safeParse({
        amount: 5,
        recipient: {},
      });
    expect(result.success).toBe(false);
    const problem = toProblem(result.error);
    expect(problem.status).toBe(400);
    expect(problem.body.code).toBe('VALIDATION');
    expect(Object.keys(problem.body.errors ?? {}).sort()).toEqual(['amount', 'recipient.type']);
  });

  it('never leaks the message of an unexpected error', () => {
    const problem = toProblem(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(problem.status).toBe(500);
    expect(problem.body.code).toBe('INTERNAL');
    expect(JSON.stringify(problem.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
    expect(toProblem('a string was thrown').status).toBe(500);
  });
});

describe('request schemas', () => {
  it('accepts money only as integer minor units', () => {
    expect(minorAmountSchema.parse('150000')).toBe(150_000n);
    expect(minorAmountSchema.parse(2500)).toBe(2_500n);
    expect(minorAmountSchema.parse('999999999999999999')).toBe(999_999_999_999_999_999n);
    for (const bad of [
      '0',
      '-1',
      '1.5',
      '1e3',
      ' ',
      '01',
      1.5,
      0,
      -3,
      Number.MAX_SAFE_INTEGER + 2,
      null,
    ]) {
      expect(minorAmountSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('validates recipients and refuses unknown body fields', () => {
    expect(recipientSchema.parse({ type: 'wallet', identifier: ' +237699000101 ' })).toEqual({
      type: 'wallet',
      identifier: '+237699000101',
    });
    expect(
      recipientSchema.safeParse({
        type: 'mobile_money',
        provider: 'MTN-MoMo-CM',
        accountNumber: '237677000001',
        name: 'A B',
      }).data,
    ).toMatchObject({ provider: 'mtn-momo-cm' });
    expect(recipientSchema.safeParse({ type: 'bank', iban: 'X' }).success).toBe(false);
    expect(
      recipientSchema.safeParse({
        type: 'mobile_money',
        provider: '../x',
        accountNumber: '237677000001',
        name: 'A B',
      }).success,
    ).toBe(false);

    const recipient = { type: 'wallet', identifier: 'a@b.test' };
    expect(transferBodySchema.safeParse({ recipient }).success).toBe(false); // neither amount nor quote
    expect(transferBodySchema.safeParse({ recipient, amount: '10' }).success).toBe(true);
    expect(
      transferBodySchema.safeParse({ recipient, quoteId: '7e0c8f5a-9d1b-4c7e-8a21-6f4d2b9c0e13' })
        .success,
    ).toBe(true);
    expect(transferBodySchema.safeParse({ recipient, amount: '10', partnerId: 'x' }).success).toBe(
      false,
    );
    expect(
      transferBodySchema.safeParse({ recipient, amount: '10', purpose: 'BRIBE' }).success,
    ).toBe(false);
    expect(
      quoteBodySchema.safeParse({ recipient, amount: '10', sourceCurrency: 'xaf' }).data
        ?.sourceCurrency,
    ).toBe('XAF');
    expect(
      quoteBodySchema.safeParse({ recipient, amount: '10', sourceCurrency: 'BTC' }).success,
    ).toBe(false);
  });

  it('bounds list queries', () => {
    expect(transferListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(transferListQuerySchema.parse({ from: '2026-11-01', pageSize: '100' })).toMatchObject({
      pageSize: 100,
      from: new Date('2026-11-01T00:00:00.000Z'),
    });
    for (const bad of [
      { pageSize: '101' },
      { page: '0' },
      { status: 'DONE' },
      { from: 'yesterday' },
    ]) {
      expect(transferListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('API reference catalogue', () => {
  it('documents only routes that exist, with scopes the service knows', () => {
    expect(API_ENDPOINTS.length).toBeGreaterThanOrEqual(7);
    for (const endpoint of API_ENDPOINTS) {
      const routeFile = appPath(`${endpoint.path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`);
      expect(existsSync(routeFile), `${endpoint.method} ${endpoint.path}`).toBe(true);
      if (endpoint.scope) expect(API_KEY_SCOPES).toContain(endpoint.scope);
      for (const code of endpoint.errors) expect(ERROR_STATUS).toHaveProperty(code);
      // Examples must be JSON without bigint/number money: every amount-like field is a string.
      const text = JSON.stringify(endpoint.responseExample);
      expect(text).not.toMatch(
        /"(sendAmount|feeAmount|totalDebit|receiveAmount|balance|amount)":\s*\d/,
      );
    }
    for (const required of [
      'GET /api/v1/me',
      'GET /api/v1/rates',
      'POST /api/v1/quotes',
      'POST /api/v1/transfers',
      'GET /api/v1/transfers',
      'GET /api/v1/transfers/{reference}',
      'GET /api/v1/providers',
    ]) {
      expect(API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toContain(
        required,
      );
    }
  });

  it('lists every error code and every webhook event', () => {
    for (const error of API_ERRORS) expect(ERROR_STATUS[error.code]).toBe(error.status);
    expect(API_ERRORS.map((error) => error.code).sort()).toEqual(
      (Object.keys(ERROR_STATUS) as ErrorCode[]).filter((code) => code !== 'KYC_REQUIRED').sort(),
    );
    expect(WEBHOOK_EVENTS.map((event) => event.type).sort()).toEqual(
      [...PARTNER_EVENT_TYPES].sort(),
    );
  });

  it('generates an OpenAPI 3.1 document covering every endpoint', () => {
    const document = buildOpenApiDocument({
      serverUrl: 'https://lite.example',
      appName: 'BI-Rem Lite',
    });
    expect(document.openapi).toBe('3.1.0');
    expect(document.servers).toEqual([{ url: 'https://lite.example' }]);
    for (const endpoint of API_ENDPOINTS) {
      const operation = document.paths[endpoint.path]?.[endpoint.method.toLowerCase()] as
        { security: unknown; responses: Record<string, unknown> } | undefined;
      expect(operation, `${endpoint.method} ${endpoint.path}`).toBeDefined();
      expect(operation?.security).toEqual([{ apiKey: [] }]);
      expect(operation?.responses).toHaveProperty(String(endpoint.successStatus));
    }
    expect(document.components.securitySchemes.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});

describe('status page build info', () => {
  it('reports the version and only well-formed deployment facts', () => {
    const info = getBuildInfo({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
      VERCEL_GIT_COMMIT_REF: 'feat/partner-portal',
      VERCEL_REGION: 'cdg1',
    });
    expect(info).toEqual({
      version: expect.stringMatching(/^\d+\.\d+\.\d+/) as string,
      commit: '0123456',
      branch: 'feat/partner-portal',
      environment: 'preview',
      region: 'cdg1',
    });
    const local = getBuildInfo({ NODE_ENV: 'development', VERCEL_GIT_COMMIT_SHA: '<script>' });
    expect(local).toMatchObject({
      commit: null,
      branch: null,
      environment: 'development',
      region: null,
    });
  });
});
