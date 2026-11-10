import type { Role } from '@/generated/prisma/enums';

import { canAccessPath, homePathForRole } from '../rbac';

const AREAS = ['/app', '/admin', '/partner'] as const;

/**
 * Where to send a user after sign-in. `next` comes from the query string, so it is hostile
 * input: only a same-origin absolute path inside an area the user's role may open is honoured;
 * everything else falls back to the role's home.
 *
 * Refused: other origins (`//host`, `https://…`, backslash tricks), control characters, dot
 * segments and encoded separators (`/app/../admin`, `/app/%2e%2e/admin`) — those pass a prefix
 * check as `/app/…` but resolve somewhere else once the browser normalises them.
 */
export function safeNextPath(next: string | undefined, role: Role): string {
  const home = homePathForRole(role);
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return home;
  const hasControlCharacter = [...next].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasControlCharacter) return home;
  const path = next.split(/[?#]/)[0] ?? '';
  if (/(^|\/)\.{1,2}(\/|$)/.test(path) || /%(2e|2f|5c)/i.test(path)) return home;
  const inArea = AREAS.some((area) => path === area || path.startsWith(`${area}/`));
  return inArea && canAccessPath(role, path) ? next : home;
}
