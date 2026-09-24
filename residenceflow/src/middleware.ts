import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/activate-account", "/mfa", "/unauthorized", "/setup", "/verify", "/api/health", "/api/cron", "/api/webhooks", "/_next", "/favicon"];

/**
 * Edge middleware: adds security headers + a correlation ID, and short-circuits unauthenticated
 * requests to protected pages. Authorisation itself is always enforced on the server (pages,
 * actions and route handlers) — this is only a first, cheap gate.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = req.cookies.has("rf_session");
  const correlationId = req.headers.get("x-correlation-id") ?? crypto.randomUUID();

  if (!isPublic && !hasSession && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-correlation-id", correlationId);
  const res = NextResponse.next({ request: { headers } });
  const dev = process.env.NODE_ENV !== "production";
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("x-correlation-id", correlationId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
