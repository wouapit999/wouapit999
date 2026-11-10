import packageJson from '../../../package.json';

/**
 * What is running: application version plus the deployment facts Vercel exposes to the build
 * and the runtime (commit, branch, environment, region). Nothing here is secret; anything that
 * is not known (local development) is reported as such rather than invented.
 */
export interface BuildInfo {
  readonly version: string;
  /** Short commit SHA, or null outside a Git-connected deployment. */
  readonly commit: string | null;
  readonly branch: string | null;
  /** `production`, `preview` or `development`. */
  readonly environment: string;
  readonly region: string | null;
}

const clean = (value: string | undefined, pattern: RegExp): string | null =>
  value && pattern.test(value) ? value : null;

export function getBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const sha = clean(env.VERCEL_GIT_COMMIT_SHA, /^[0-9a-f]{7,64}$/i);
  return {
    version: packageJson.version,
    commit: sha ? sha.slice(0, 7) : null,
    branch: clean(env.VERCEL_GIT_COMMIT_REF, /^[\w./-]{1,100}$/),
    environment:
      clean(env.VERCEL_ENV, /^(production|preview|development)$/) ??
      (env.NODE_ENV === 'production' ? 'production' : 'development'),
    region: clean(env.VERCEL_REGION, /^[a-z0-9-]{2,20}$/),
  };
}
