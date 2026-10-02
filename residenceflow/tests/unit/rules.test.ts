import { describe, expect, it } from "vitest";
import { activationErrors, canTransitionLease, findOverlaps } from "@/domain/lease-rules";
import { canTransitionWorkOrder } from "@/domain/work-order";
import { utcDate } from "@/domain/schedule";
import { renderTemplate } from "@/domain/template";
import { hotp, verifyTotp, generateTotpSecret } from "@/domain/totp";
import { broadestScope, hasPermission, SYSTEM_ROLES, ALL_PERMISSIONS } from "@/lib/permissions";
import { sanitizeForAudit } from "@/lib/audit";

describe("lease overlap", () => {
  const existing = [{ id: "1", startDate: utcDate(2026, 0, 1), endDate: utcDate(2026, 11, 31), status: "ACTIVE" }];
  it("detects overlapping active leases", () => {
    expect(findOverlaps({ startDate: utcDate(2026, 5, 1), endDate: utcDate(2027, 5, 1), status: "DRAFT" }, existing)).toHaveLength(1);
  });
  it("allows adjacent leases", () => {
    expect(findOverlaps({ startDate: utcDate(2027, 0, 1), endDate: utcDate(2027, 11, 31), status: "DRAFT" }, existing)).toHaveLength(0);
  });
  it("ignores terminated leases and shared tenancy", () => {
    expect(findOverlaps({ startDate: utcDate(2026, 5, 1), endDate: utcDate(2026, 6, 1), status: "DRAFT" }, [{ ...existing[0], status: "TERMINATED" }])).toHaveLength(0);
    expect(findOverlaps({ startDate: utcDate(2026, 5, 1), endDate: utcDate(2026, 6, 1), status: "DRAFT" }, existing, true)).toHaveLength(0);
  });
});

describe("lease activation + transitions", () => {
  it("requires all mandatory fields", () => {
    expect(activationErrors({})).toEqual(expect.arrayContaining(["unit", "tenant", "dates", "rent", "frequency", "dueDay"]));
    expect(activationErrors({ unitId: "u", tenantId: "t", startDate: utcDate(2026, 0, 1), endDate: utcDate(2026, 11, 31), rentAmount: "1", frequency: "MONTHLY", dueDay: 5 })).toEqual([]);
  });
  it("enforces the lease state machine", () => {
    expect(canTransitionLease("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionLease("PENDING_APPROVAL", "ACTIVE")).toBe(true);
    expect(canTransitionLease("TERMINATED", "ACTIVE")).toBe(false);
  });
  it("enforces the work-order state machine", () => {
    expect(canTransitionWorkOrder("SUBMITTED", "CLOSED")).toBe(false);
    expect(canTransitionWorkOrder("COMPLETED", "CLOSED")).toBe(true);
    expect(canTransitionWorkOrder("CLOSED", "REOPENED")).toBe(true);
  });
});

describe("permissions", () => {
  it("evaluates required permissions", () => {
    const g = new Set(["payment.view", "payment.record"]);
    expect(hasPermission(g, "payment.record")).toBe(true);
    expect(hasPermission(g, ["payment.record", "payment.reverse"])).toBe(false);
  });
  it("picks the broadest scope", () => {
    expect(broadestScope(["OWN", "ASSIGNED_BUILDINGS"])).toBe("ASSIGNED_BUILDINGS");
    expect(broadestScope([])).toBe("OWN");
  });
  it("system roles only use known permissions and tenants get no staff permissions", () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    const tenant = SYSTEM_ROLES.find((r) => r.key === "tenant")!;
    expect(tenant.permissions).toEqual(["portal.access"]);
  });
  it("concierge cannot see finances; auditor is read-only", () => {
    const concierge = SYSTEM_ROLES.find((r) => r.key === "concierge")!;
    expect(concierge.permissions.some((p) => p.startsWith("payment.") || p.startsWith("invoice."))).toBe(false);
    const auditor = SYSTEM_ROLES.find((r) => r.key === "auditor")!;
    expect(auditor.permissions.every((p) => p.endsWith(".view"))).toBe(true);
  });
  it("no org role holds platform permissions", () => {
    for (const r of SYSTEM_ROLES) expect(r.permissions).not.toContain("platform.organizations.manage");
  });
});

describe("templates", () => {
  it("replaces only known placeholders and escapes HTML", () => {
    expect(renderTemplate("Hi {{name}} {{unknown}}", { name: "<b>A</b>" }, { html: true })).toBe("Hi &lt;b&gt;A&lt;/b&gt; ");
  });
});

describe("TOTP", () => {
  it("matches RFC 4226 test vectors", () => {
    // secret "12345678901234567890" in base32
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(hotp(secret, 0)).toBe("755224");
    expect(hotp(secret, 1)).toBe("287082");
  });
  it("verifies within the drift window", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, hotp(s, Math.floor(now / 30000)), now)).toBe(true);
    expect(verifyTotp(s, "000000", now) && verifyTotp(s, "111111", now)).toBe(false);
  });
});

describe("audit sanitising", () => {
  it("redacts secrets", () => {
    expect(sanitizeForAudit({ passwordHash: "x", name: "A", nested: { token: "t" } })).toEqual({
      passwordHash: "[redacted]", name: "A", nested: { token: "[redacted]" },
    });
  });
});
