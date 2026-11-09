import { describe, expect, it, jest } from '@jest/globals';
import { type CallHandler, type ExecutionContext, ForbiddenException, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';

import { RequestContext } from '../../common/context/request-context.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import type { AuditEntry, AuditLogService } from './audit-log.service.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { REDACTED, redact } from './redact.js';

class UsersController {
  @Post()
  create(): void {}

  @Audit({ action: 'users.password.reset', resource: 'Credential', idParam: 'userId' })
  reset(): void {}
}

function context(
  handler: (...args: never[]) => unknown,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function harness() {
  const record = jest.fn<(entry: AuditEntry) => Promise<null>>(async () => null);
  const interceptor = new AuditInterceptor(new Reflector(), {
    record,
  } as unknown as AuditLogService);
  return { interceptor, record };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('redact', () => {
  it('masks sensitive keys recursively and keeps the rest', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'hunter2',
      nested: { refreshToken: 'abc', keyHash: 'h', mfaSecret: 's', list: [{ apiKey: 'k', ok: 1 }] },
      authorization: 'Bearer x',
      nullSecret: null,
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe(REDACTED);
    expect(out.authorization).toBe(REDACTED);
    expect(out.nullSecret).toBeNull();
    const nested = out.nested as Record<string, unknown>;
    expect(nested.refreshToken).toBe(REDACTED);
    expect(nested.keyHash).toBe(REDACTED);
    expect(nested.mfaSecret).toBe(REDACTED);
    expect((nested.list as Array<Record<string, unknown>>)[0]).toEqual({ apiKey: REDACTED, ok: 1 });
  });

  it('masks one-time codes by exact key while keeping look-alike keys such as countryCode', () => {
    const out = redact({
      code: '123456',
      pin: '0000',
      countryCode: 'SN',
      mfaToken: 'challenge',
      encoding: 'utf8',
    }) as Record<string, unknown>;
    expect(out.code).toBe(REDACTED);
    expect(out.pin).toBe(REDACTED);
    expect(out.mfaToken).toBe(REDACTED);
    expect(out.countryCode).toBe('SN');
    expect(out.encoding).toBe('utf8');
  });

  it('bounds depth and string length, serialises dates and bigints', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
    expect((redact('x'.repeat(5_000)) as string).length).toBeLessThan(2_100);
    expect(redact({ at: new Date('2026-01-01T00:00:00Z'), big: 10n })).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      big: '10',
    });
  });
});

describe('AuditInterceptor', () => {
  it('derives action and resource from controller and handler names', () => {
    const { interceptor } = harness();
    const described = interceptor.describe(context(UsersController.prototype.create, {}));
    expect(described).toEqual({ action: 'users.create', resource: 'User', idParam: 'id' });
  });

  it('honours @Audit() overrides', () => {
    const { interceptor } = harness();
    expect(interceptor.describe(context(UsersController.prototype.reset, {}))).toEqual({
      action: 'users.password.reset',
      resource: 'Credential',
      idParam: 'userId',
    });
  });

  it('records a redacted body with SUCCESS outcome and the response id', async () => {
    const { interceptor, record } = harness();
    const request = {
      method: 'POST',
      path: '/v1/users',
      originalUrl: '/v1/users',
      params: {},
      body: { email: 'a@b.c', password: 'hunter2', profile: { token: 't' } },
      headers: { 'user-agent': 'jest' },
      ip: '10.0.0.1',
      res: { statusCode: 201 },
      user: { type: 'USER', userId: 'actor-1' },
    };
    const next: CallHandler = { handle: () => of({ id: 'new-user-id' }) };
    await RequestContext.run({ correlationId: 'corr-1' }, async () => {
      RequestContext.recordBefore({ password: 'old', status: 'PENDING' });
      await lastValueFrom(
        interceptor.intercept(context(UsersController.prototype.create, request), next),
      );
      await flush();
    });
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]![0];
    expect(entry.action).toBe('users.create');
    expect(entry.resourceType).toBe('User');
    expect(entry.resourceId).toBe('new-user-id');
    expect(entry.outcome).toBe('SUCCESS');
    expect(entry.actorUserId).toBe('actor-1');
    expect(entry.before).toEqual({ password: 'old', status: 'PENDING' });
    // The interceptor redacts the body itself (AuditLogService.record() redacts again).
    expect(entry.after).toEqual({
      email: 'a@b.c',
      password: REDACTED,
      profile: { token: REDACTED },
    });
    expect(entry.metadata).toMatchObject({ method: 'POST', statusCode: 201 });
  });

  it('redacts secrets before truncating oversized bodies so the preview cannot leak them', async () => {
    const { interceptor, record } = harness();
    const request = {
      method: 'POST',
      path: '/v1/auth/register',
      originalUrl: '/v1/auth/register',
      params: {},
      // Several long fields: redact() caps each string at 2 000 chars, the row cap is 8 000.
      body: {
        email: 'a@b.c',
        password: 'Sup3r-Secret-Pass!',
        ...Object.fromEntries(
          Array.from({ length: 6 }, (_, index) => [`notes${index}`, 'x'.repeat(1_900)]),
        ),
      },
      headers: {},
      res: { statusCode: 201 },
    };
    const next: CallHandler = { handle: () => of({ id: 'u-1' }) };
    await RequestContext.run({ correlationId: 'corr-2' }, async () => {
      await lastValueFrom(
        interceptor.intercept(context(UsersController.prototype.create, request), next),
      );
      await flush();
    });
    const after = record.mock.calls[0]![0].after as { _truncated: true; preview: string };
    expect(after._truncated).toBe(true);
    expect(after.preview).not.toContain('Sup3r-Secret-Pass!');
    expect(after.preview).toContain(REDACTED);
  });

  it('records DENIED for 403 errors and FAILURE for other errors', async () => {
    const { interceptor, record } = harness();
    const request = {
      method: 'DELETE',
      path: '/v1/users/1',
      originalUrl: '/v1/users/1',
      params: { id: 'u-1' },
      body: {},
      headers: {},
    };
    const denied: CallHandler = { handle: () => throwError(() => new ForbiddenException()) };
    await expect(
      lastValueFrom(
        interceptor.intercept(context(UsersController.prototype.create, request), denied),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await flush();
    expect(record.mock.calls[0]![0]).toMatchObject({ outcome: 'DENIED', resourceId: 'u-1' });

    const failed: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      lastValueFrom(
        interceptor.intercept(context(UsersController.prototype.create, request), failed),
      ),
    ).rejects.toThrow('boom');
    await flush();
    expect(record.mock.calls[1]![0]).toMatchObject({ outcome: 'FAILURE' });
  });

  it('ignores GET requests', async () => {
    const { interceptor, record } = harness();
    const next: CallHandler = { handle: () => of('ok') };
    await lastValueFrom(
      interceptor.intercept(
        context(UsersController.prototype.create, { method: 'GET', headers: {} }),
        next,
      ),
    );
    await flush();
    expect(record).not.toHaveBeenCalled();
  });
});
