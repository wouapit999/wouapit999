# Security policy

BI-Rem handles money movement and personal data. We take every report seriously and
appreciate responsible disclosure.

## Reporting a vulnerability

- Preferred: open a private advisory at
  <https://github.com/wouapit999/wouapit999/security/advisories/new>.
- Alternative: e-mail **security@bi-rem.africa** (PGP key published at
  `https://bi-rem.africa/.well-known/security.txt` once the domain is live).
- Please do **not** open public issues, pull requests or discussions for security problems.

Include what you can: affected component (`apps/api`, `apps/web`, `apps/admin`,
`packages/db`, `infra`), version or commit, reproduction steps, impact assessment and any
proof-of-concept. Do not access, modify or exfiltrate data that is not yours; use the
staging environment or a local checkout for testing.

## What to expect

| Step                           | Target                                                   |
| ------------------------------ | -------------------------------------------------------- |
| Acknowledgement                | within 2 business days                                   |
| Triage and severity (CVSS 3.1) | within 5 business days                                   |
| Fix for Critical / High        | 14 days (hotfix release)                                 |
| Fix for Medium                 | next scheduled release (≤ 60 days)                       |
| Fix for Low                    | best effort, tracked publicly after the fix              |
| Public disclosure              | coordinated with the reporter, after the fix is deployed |

We will keep you informed throughout and credit you in the release notes if you wish. There
is no paid bounty programme at this stage.

## Supported versions

Only the latest release on `main` and the currently deployed production tag receive security
fixes. Phase branches that have not shipped are not supported.

## Scope

In scope: this repository, the deployed API (`api.*.bi-rem.africa`), the customer and
admin portals, container images published to `ghcr.io/wouapit999/bi-rem-api`, CI/CD
configuration.

Out of scope: third-party services we rely on (Fly.io, Vercel, Neon, Upstash, SMTP
providers) — report to them directly — and findings that require physical access, social
engineering of staff, or denial of service by volumetric traffic.

## Security controls (summary)

- Passwords hashed with argon2id; JWT access tokens (15 min) + rotating opaque refresh
  tokens with reuse detection; optional TOTP MFA with encrypted secrets.
- RBAC permissions enforced server-side on every route; all mutating requests audited with
  actor, before/after diff, IP, user agent and correlation id.
- Field-level encryption (AES-256-GCM) for secret settings; secrets only in provider stores
  (`infra/scripts/rotate-secrets.md`).
- Helmet, strict CORS allowlist, rate limiting, CSP and HSTS on the portals.
- CI: CodeQL, dependency review, gitleaks, `pnpm audit`, Trivy image scan
  (`.github/workflows/security.yml`); Dependabot weekly.
- Images run as non-root with read-only root filesystem where possible; infrastructure as
  code reviewed through pull requests with CODEOWNERS.
