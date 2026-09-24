import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { BusinessError, ForbiddenError } from "@/lib/errors";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export { BusinessError };

/**
 * Wraps a server action body: converts validation/authorization/business errors into
 * a consistent result object and never leaks internal database errors to the client.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const k = issue.path.join(".") || "_";
        (fieldErrors[k] ??= []).push(issue.message);
      }
      return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
    }
    if (e instanceof ForbiddenError) return { ok: false, error: "You are not allowed to perform this action." };
    if (e instanceof BusinessError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "A record with the same unique value already exists." };
    }
    console.error(JSON.stringify({ level: "error", msg: "action_failed", name: (e as Error)?.name, message: (e as Error)?.message }));
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** FormData → plain object (checkbox "on" → true, repeated keys → arrays). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? v : v;
    if (k in out) {
      const cur = out[k];
      out[k] = Array.isArray(cur) ? [...cur, val] : [cur, val];
    } else out[k] = val;
  }
  return out;
}

/** Adds a success message to an ActionResult. */
export function withMessage<T>(r: ActionResult<T>, message: string): ActionResult<T> {
  return r.ok ? { ...r, message } : r;
}
