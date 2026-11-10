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

/**
 * Links to the guides that live in the repository rather than in the app (phase 12): the deploy
 * guide, the go-live checklist and the CI pipeline. On a Git-connected Vercel deployment they
 * point at the repository and commit that were deployed; anywhere else at the canonical
 * repository's default branch.
 */
export interface RepositoryLinks {
  readonly repository: string;
  readonly deployGuide: string;
  readonly goLiveChecklist: string;
  readonly liteDocs: string;
  readonly ciWorkflow: string;
}

const CANONICAL_REPOSITORY = 'https://github.com/wouapit999/wouapit999';

export function getRepositoryLinks(env: NodeJS.ProcessEnv = process.env): RepositoryLinks {
  const owner = clean(env.VERCEL_GIT_REPO_OWNER, /^[\w.-]{1,100}$/);
  const slug = clean(env.VERCEL_GIT_REPO_SLUG, /^[\w.-]{1,100}$/);
  const sha = clean(env.VERCEL_GIT_COMMIT_SHA, /^[0-9a-f]{7,64}$/i);
  const deployedFromGitHub = env.VERCEL_GIT_PROVIDER === 'github' && owner && slug && sha;
  const repository = deployedFromGitHub
    ? `https://github.com/${owner}/${slug}`
    : CANONICAL_REPOSITORY;
  const ref = deployedFromGitHub ? sha : 'main';
  return {
    repository,
    deployGuide: `${repository}/blob/${ref}/apps/lite/DEPLOY.md`,
    goLiveChecklist: `${repository}/blob/${ref}/docs/07-go-live-checklist.md`,
    liteDocs: `${repository}/blob/${ref}/docs/lite/README.md`,
    ciWorkflow: `${repository}/actions/workflows/ci.yml`,
  };
}
