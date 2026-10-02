import type { T } from "@/i18n";

export function passwordDict(t: T) {
  const keys = ["password.tooShort", "password.tooLong", "password.complexity", "password.mismatch", "password.reused", "password.currentWrong", "auth.tokenInvalid"];
  return Object.fromEntries(keys.map((k) => [k, t(k)]));
}
