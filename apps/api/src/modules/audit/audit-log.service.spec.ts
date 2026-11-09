import { describe, expect, it, jest } from '@jest/globals';

import { RequestContext } from '../../common/context/request-context.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuditLogService } from './audit-log.service.js';
import { REDACTED } from './redact.js';

describe('AuditLogService.record', () => {
  it('redacts before/after and fills actor and correlation data from the request context', async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'a1',
      ...args.data,
    }));
    const service = new AuditLogService({
      client: { auditLog: { create } },
    } as unknown as PrismaService);
    await RequestContext.run(
      {
        correlationId: 'corr-9',
        ip: '1.2.3.4',
        userAgent: 'ua',
        actor: {
          type: 'USER',
          id: 'u1',
          userId: 'u1',
          apiKeyId: null,
          realm: 'ADMIN',
          email: 'a@b.c',
          roles: [],
          permissions: [],
          sessionId: 's1',
        },
      },
      () =>
        service.record({
          action: 'users.update',
          resourceType: 'User',
          resourceId: 'u2',
          outcome: 'SUCCESS',
          before: { passwordHash: 'x', email: 'old@b.c' },
          after: { passwordHash: 'y', email: 'new@b.c', token: 't' },
        }),
    );
    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      actorUserId: 'u1',
      actorType: 'USER',
      correlationId: 'corr-9',
      ip: '1.2.3.4',
      userAgent: 'ua',
      before: { passwordHash: REDACTED, email: 'old@b.c' },
      after: { passwordHash: REDACTED, email: 'new@b.c', token: REDACTED },
    });
    expect(data.metadata).toMatchObject({ actorRealm: 'ADMIN' });
  });

  it('never throws when the write fails', async () => {
    const create = jest.fn(async () => {
      throw new Error('db down');
    });
    const service = new AuditLogService({
      client: { auditLog: { create } },
    } as unknown as PrismaService);
    await expect(
      service.record({ action: 'x.y', resourceType: 'X', outcome: 'FAILURE' }),
    ).resolves.toBeNull();
  });
});
