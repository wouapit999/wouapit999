# Security

## Threat model (summary)

| Asset | Threats | Primary controls |
|---|---|---|
| Accounts & sessions | credential stuffing, brute force, session theft, enumeration | bcrypt (cost 12); per-account lockout + per-IP rate limit (DB-backed `LoginAttempt`); generic auth errors + dummy hash comparison for unknown users; opaque random session tokens, only SHA-256 hashes stored; `HttpOnly`/`Secure`/`SameSite=Lax` cookies; configurable timeout; session list + revocation; optional TOTP MFA with hashed single-use recovery codes |
| Password recovery | token theft / reuse / guessing | 256-bit tokens, hashed at rest, 30-min (reset) / 72-h (activation) expiry, single use enforced by conditional update inside a transaction; all sessions revoked after reset; identical response whether or not the account exists; per-IP request limit |
| Tenant data (PII) | horizontal privilege escalation / IDOR | every query built from scoping helpers incl. `organizationId`; portal bound to `ctx.tenantId`; IDs re-loaded through scoped filters (→ 404); ID numbers stored masked only; sensitive documents need `document.sensitive.view` |
| Financial records | tampering, double posting, silent edits | server-only services; row locks + transactions; immutable issued invoices/receipts (void/credit/reversal instead of edits); no hard deletes; separation of duties; mandatory reasons; full audit trail |
| Configuration & roles | vertical privilege escalation, admin lockout | `settings.*` permissions; powerful permissions grantable only by role managers; platform permissions never grantable to org roles; last-admin protection; recent re-authentication for permission/security/MFA changes |
| Files | malware, XSS via uploads, path traversal | allow-listed MIME types + magic-byte checks, 4 MB limit, SVG sanitisation check for branding, scan hook, `Content-Disposition: attachment` + `nosniff`, per-request authorization on download |
| Webhooks & cron | forged callbacks, replay | HMAC signature + 5-minute timestamp window, constant-time compare, idempotent processing, amount/currency matching; cron requires `Bearer CRON_SECRET` |
| Browser | XSS, clickjacking, CSRF | React output encoding; CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`; server actions enforce same-origin (Next.js Origin check) and `SameSite=Lax` cookies; forms use POST only |
| Logs | secret / PII leakage | audit metadata passes through `sanitizeForAudit` (redacts password/token/secret/hash/mfa/idNumber keys, strips data URLs); structured error logs never include request bodies; emails with tokens are never logged |

## Controls checklist

- [x] Server-side RBAC in pages, actions, route handlers and services
- [x] Organization-level isolation on every query
- [x] Passwords hashed (bcrypt 12); policy (length, 3 character classes, history)
- [x] Admins can only issue reset links / force change — never view or set passwords
- [x] Account lockout, IP rate limiting, generic errors
- [x] MFA (TOTP) with recovery codes; MFA reset is privileged + audited
- [x] Session timeout, listing, revocation; revocation of other sessions on password change
- [x] Re-authentication for sensitive admin actions
- [x] Input validation with Zod on every server action
- [x] Parameterised queries (Prisma; the few raw queries use tagged templates)
- [x] CSP and security headers; HSTS in production
- [x] Upload validation + malware-scan integration point
- [x] Append-only audit log (no update/delete path in the application)
- [x] Secrets only via environment variables; `.env.example` has placeholders only
- [x] Dependency audit in CI
- [ ] CAPTCHA after suspicious attempts — integration point: `loginAction` (currently lockout + rate limiting only)
- [ ] Field-level encryption of especially sensitive fields — not required today because raw ID numbers are never stored
- [ ] External penetration test before production go-live

## Sensitive actions requiring re-authentication

Changing role permissions, changing security settings, resetting another user's MFA. (Payment reversal requires the dedicated `payment.reverse` permission, a reason and is audited.)

## Reporting a vulnerability

Please report privately to the maintainers; do not open a public issue.
