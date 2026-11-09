/** Failed password attempts before the account is temporarily locked (overridable via settings). */
export const DEFAULT_MAX_FAILED_LOGINS = 5;
/** Lockout duration applied once the threshold is reached (overridable via settings). */
export const DEFAULT_LOCKOUT_MINUTES = 15;
/** Lifetime of the second-factor challenge token issued after a correct password. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
/** Lifetime of password-reset links. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
/** Lifetime of admin invitation (set-password) links. */
export const INVITE_TTL_SECONDS = 24 * 60 * 60;
/** TOTP verification tolerance in seconds (one 30 s step either side). */
export const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
/** `iss` claim stamped on every JWT the API signs and required on verification. */
export const JWT_ISSUER = 'bi-rem-api';
/** Settings keys consulted for lockout policy (seeded by packages/db). */
export const SETTING_MAX_FAILED_LOGINS = 'auth.max-failed-login-attempts';
export const SETTING_LOCKOUT_MINUTES = 'auth.lockout-minutes';

export type TokenPurpose = 'mfa' | 'password_reset' | 'invite';
