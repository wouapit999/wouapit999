import { z } from 'zod';

/**
 * Environment contract for the admin portal.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle by Next.js, which only works when
 * each variable is read with a literal `process.env.NEXT_PUBLIC_X` expression — hence the
 * explicit object below instead of a loop. `next.config.ts` imports this module so an invalid
 * value fails `next build` instead of surfacing at runtime.
 */

const httpUrl = z
  .url({ protocol: /^https?$/, error: 'Must be an http(s) URL' })
  .transform((value) => value.replace(/\/+$/, ''));

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const DEPLOY_ENVS = ['sandbox', 'production'] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: httpUrl.default('http://localhost:4000'),
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).max(60).default('BI-Rem'),
  NEXT_PUBLIC_ENV: z.enum(DEPLOY_ENVS).default('sandbox'),
  NEXT_PUBLIC_APP_URL: httpUrl.optional(),
});

const serverEnvSchema = z.object({
  API_INTERNAL_URL: httpUrl.optional(),
  AUTH_COOKIE_SECURE: booleanish.optional(),
  HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3_000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Empty strings (e.g. `FOO=` in a .env file) are treated as unset. */
function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

function parsePublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: blankToUndefined(process.env.NEXT_PUBLIC_API_URL),
    NEXT_PUBLIC_APP_NAME: blankToUndefined(process.env.NEXT_PUBLIC_APP_NAME),
    NEXT_PUBLIC_ENV: blankToUndefined(process.env.NEXT_PUBLIC_ENV),
    NEXT_PUBLIC_APP_URL: blankToUndefined(process.env.NEXT_PUBLIC_APP_URL),
  });
  if (!result.success) {
    throw new Error(`Invalid public environment variables:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/** Validated `NEXT_PUBLIC_*` variables; safe to import from client and server code. */
export const publicEnv: PublicEnv = parsePublicEnv();

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server-only variables, parsed lazily so importing this module from the client bundle never
 * touches them. Callers must only use this from route handlers, server components or proxy.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must not be called in the browser');
  }
  if (!cachedServerEnv) {
    const result = serverEnvSchema.safeParse({
      API_INTERNAL_URL: blankToUndefined(process.env.API_INTERNAL_URL),
      AUTH_COOKIE_SECURE: blankToUndefined(process.env.AUTH_COOKIE_SECURE),
      HEALTH_TIMEOUT_MS: blankToUndefined(process.env.HEALTH_TIMEOUT_MS),
      NODE_ENV: blankToUndefined(process.env.NODE_ENV),
    });
    if (!result.success) {
      throw new Error(`Invalid server environment variables:\n${formatIssues(result.error)}`);
    }
    cachedServerEnv = result.data;
  }
  return cachedServerEnv;
}

/** Base URL route handlers use to reach the API (internal URL when configured). */
export function getApiBaseUrl(): string {
  return getServerEnv().API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL;
}
