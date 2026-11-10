import { z } from 'zod';

import { apiHandler, fileResponse } from '@/lib/http';
import { getActionContext } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { isStaff } from '@/server/rbac';
import { EXPORT_FORMATS, REPORT_NAMES, exportReport, resolveRange } from '@/server/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  format: z.enum(EXPORT_FORMATS).default('csv'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
});

/**
 * GET /api/exports/<report>?format=csv|xlsx|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD (or &days=30)
 *
 * Back-office report download. The session is checked here; `exportReport` asserts
 * `reports:export` (plus the dataset's own permission) and writes the audit row.
 */
export const GET = apiHandler(
  async (request: Request, { params }: { params: Promise<{ name: string }> }) => {
    const ctx = await getActionContext();
    if (!isStaff(ctx)) throw new AppError('FORBIDDEN', 'Reports are for back-office staff');
    const { name } = await params;
    if (!(REPORT_NAMES as readonly string[]).includes(name)) {
      throw new AppError('NOT_FOUND', 'Unknown report');
    }
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const range = resolveRange({ from: query.from, to: query.to, days: query.days });
    const file = await exportReport(ctx, name, query.format, range);
    return fileResponse(file.data, { contentType: file.contentType, fileName: file.fileName });
  },
);
