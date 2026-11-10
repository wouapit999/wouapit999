'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { setCountryEnabled, setCountryRisk } from '@/server/countries';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Unknown country');

/** Switch a market on or off (`countries:write`). Audited by the service. */
export const setCountryEnabledAction = createAction({
  schema: z.object({ code, enabled: z.enum(['true', 'false']) }),
  permission: 'countries:write',
  handler: async (input, ctx) => {
    const country = await setCountryEnabled(ctx, input.code, input.enabled === 'true');
    return { name: country.name, enabled: country.enabled };
  },
  successMessage: (result) => `${result.name} ${result.enabled ? 'enabled' : 'disabled'}`,
  revalidate: ['/admin/countries', '/admin/providers', '/status'],
});

/** Country risk rating used by the high-risk-corridor AML rule (`countries:write`). */
export const setCountryRiskAction = createAction({
  schema: z.object({ code, riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']) }),
  permission: 'countries:write',
  handler: async (input, ctx) => {
    const country = await setCountryRisk(ctx, input.code, input.riskLevel);
    return { name: country.name, riskLevel: country.riskLevel };
  },
  successMessage: (result) => `${result.name} rated ${result.riskLevel.toLowerCase()} risk`,
  revalidate: ['/admin/countries'],
});
