/**
 * Development seed. Creates one organization, two buildings, units, tenants, leases,
 * invoices, payments, maintenance, concierge records and demo users for every role.
 *
 * Demo users are created only when NODE_ENV !== "production" or SEED_DEMO=true is set
 * explicitly together with SEED_DEMO_PASSWORD. Never use demo credentials in production.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createOrganization, ensurePlatformRole } from "../src/services/org";
import { approveAndActivateLease, submitLease } from "../src/services/leases";
import { assessOverdueAndLateFees, generateDueInvoices, recordPayment } from "../src/services/billing";
import type { AuthContext } from "../src/lib/auth/context";

const db = new PrismaClient();
const isProd = process.env.NODE_ENV === "production";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? (isProd ? "" : "Demo!Pass2026");

function d(y: number, m: number, day: number) {
  return new Date(Date.UTC(y, m - 1, day));
}

async function main() {
  if (isProd && process.env.SEED_DEMO !== "true") {
    console.log("Refusing to seed demo data in production (set SEED_DEMO=true and SEED_DEMO_PASSWORD to override).");
    return;
  }
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10) throw new Error("SEED_DEMO_PASSWORD must be at least 10 characters.");
  if (await db.organization.count()) {
    console.log("Database already contains organizations — skipping seed.");
    return;
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const platformRole = await ensurePlatformRole(db);
  const org = await createOrganization(db, { name: "Résidences du Wouri SARL", slug: "wouri", appName: "ResidenceFlow" });
  await db.organizationSettings.update({
    where: { organizationId: org.id },
    data: {
      address: "Rue Joss, Bonanjo, Douala, Cameroon", phone: "+237 6 99 00 00 00", email: "contact@example.test",
      footerText: "Résidences du Wouri — gestion immobilière", lateFeeType: "PERCENT", lateFeeValue: "2.00",
      receiptFooter: "Thank you for your payment. Merci pour votre règlement.",
    },
  });
  const roles = Object.fromEntries((await db.role.findMany({ where: { organizationId: org.id } })).map((r) => [r.key, r]));

  const ph = { passwordHash: hash, status: "ACTIVE" as const, passwordChangedAt: new Date() };
  await db.user.create({ data: { email: "superadmin@example.test", name: "Platform Admin", isPlatformAdmin: true, ...ph, locale: "en", roles: { create: { roleId: platformRole.id } } } });
  const mk = (email: string, name: string, roleKey: string, extra: Record<string, unknown> = {}) =>
    db.user.create({ data: { email, name, organizationId: org.id, ...ph, ...extra, roles: { create: { roleId: roles[roleKey].id } } } });

  const admin = await mk("admin@example.test", "Aïcha Admin", "org_admin", { locale: "en" });
  const manager = await mk("manager@example.test", "Marc Manager", "property_manager");
  const owner = await mk("owner@example.test", "Olivia Owner", "owner");
  await mk("accountant@example.test", "Alain Comptable", "accountant");
  const cashier = await mk("cashier@example.test", "Carine Caissière", "cashier");
  const concierge = await mk("concierge@example.test", "Claude Concierge", "concierge");
  const mm = await mk("maintenance.manager@example.test", "Mireille Maintenance", "maintenance_manager");
  const tech = await mk("technician@example.test", "Thierry Technicien", "technician");
  await mk("auditor@example.test", "Aude Auditrice", "auditor", { locale: "en" });

  const adminCtx = { organizationId: org.id, user: { id: admin.id, name: admin.name, email: admin.email, locale: "en", mustChangePassword: false, isPlatformAdmin: false, mfaEnabled: false }, permissions: new Set(roles.org_admin.permissions), roleKeys: ["org_admin"], scope: "ORGANIZATION", propertyIds: "ALL", tenantId: null, vendorId: null, sessionId: "seed" } as unknown as AuthContext;

  // Buildings & units
  const akwa = await db.property.create({ data: { organizationId: org.id, reference: "BLD-001", name: "Résidence Akwa", type: "RESIDENTIAL", address: "Boulevard de la Liberté, Akwa", city: "Douala", floors: 5, blocks: 1, amenities: ["Generator", "Water tank", "Parking", "Security 24/7"], utilities: "Electricity per unit meter (ENEO); water shared", ownerId: owner.id } });
  const bonapriso = await db.property.create({ data: { organizationId: org.id, reference: "BLD-002", name: "Les Jardins de Bonapriso", type: "MIXED_USE", address: "Rue Njo-Njo, Bonapriso", city: "Douala", floors: 3, blocks: 2, amenities: ["Garden", "Parking", "Shops"], utilities: "Individual meters", ownerId: owner.id } });
  await db.numberSequence.update({ where: { organizationId_key: { organizationId: org.id, key: "PROPERTY" } }, data: { nextValue: 3 } });
  for (const u of [manager, owner, cashier, concierge, mm]) {
    await db.userPropertyScope.createMany({ data: [{ userId: u.id, propertyId: akwa.id }, { userId: u.id, propertyId: bonapriso.id }] });
  }

  const units: Awaited<ReturnType<typeof db.unit.create>>[] = [];
  for (let floor = 1; floor <= 4; floor++) {
    for (const letter of ["A", "B"]) {
      units.push(await db.unit.create({ data: { organizationId: org.id, propertyId: akwa.id, floor, number: `${floor}${letter}`, type: "APARTMENT", bedrooms: letter === "A" ? 3 : 2, bathrooms: letter === "A" ? 2 : 1, area: letter === "A" ? "95.00" : "70.00", defaultRent: letter === "A" ? "250000" : "180000", defaultDeposit: letter === "A" ? "500000" : "360000", defaultServiceCharge: "15000", furnishing: "UNFURNISHED" } }));
    }
  }
  for (const [i, n] of ["G1", "G2", "101", "102", "201"].entries()) {
    units.push(await db.unit.create({ data: { organizationId: org.id, propertyId: bonapriso.id, block: i < 2 ? "Commercial" : "B", floor: i < 2 ? 0 : Number(n[0]), number: n, type: i < 2 ? "SHOP" : "APARTMENT", bedrooms: i < 2 ? 0 : 2, bathrooms: 1, defaultRent: i < 2 ? "300000" : "200000", defaultDeposit: i < 2 ? "600000" : "400000" } }));
  }
  await db.unit.update({ where: { id: units[7].id }, data: { status: "UNDER_MAINTENANCE" } });

  // Tenants
  const tenantData = [
    ["Jean-Paul Mbarga", "jp.mbarga@example.test", "+237 677 11 22 33"],
    ["Fatou Ndiaye", "tenant@example.test", "+237 699 44 55 66"],
    ["Samuel Eto'o Fils", "s.fils@example.test", "+237 655 00 11 22"],
    ["Grace Achu", "g.achu@example.test", "+237 670 98 76 54"],
    ["Boulangerie Le Pain Doré SARL", "contact@paindore.example.test", "+237 233 42 00 00"],
    ["Didier Kamga", "d.kamga@example.test", "+237 691 23 45 67"],
  ];
  const tenants: Awaited<ReturnType<typeof db.tenant.create>>[] = [];
  for (const [i, [name, email, phone]] of tenantData.entries()) {
    tenants.push(await db.tenant.create({ data: { organizationId: org.id, reference: `TEN-${String(i + 1).padStart(5, "0")}`, legalName: name, email, phone, type: name.includes("SARL") ? "COMPANY" : "INDIVIDUAL", idType: "CNI", idNumberMasked: `•••••${100 + i}`, language: i % 2 ? "en" : "fr", contacts: { create: [{ kind: "EMERGENCY", name: "Contact d'urgence", phone: "+237 600 00 00 0" + i }] } } }));
  }
  await db.numberSequence.update({ where: { organizationId_key: { organizationId: org.id, key: "TENANT" } }, data: { nextValue: 7 } });
  await db.tenantContact.create({ data: { tenantId: tenants[1].id, kind: "OCCUPANT", name: "Awa Ndiaye", relationship: "Daughter" } });
  await db.tenantContact.create({ data: { tenantId: tenants[1].id, kind: "GUARANTOR", name: "Moussa Ndiaye", phone: "+237 677 00 00 01", relationship: "Brother" } });

  const tenantUser = await mk("tenant@example.test", "Fatou Ndiaye", "tenant", { tenantId: tenants[1].id, locale: "fr" });

  // Vendor + vendor user
  const vendor = await db.vendor.create({ data: { organizationId: org.id, name: "Plomberie Express Douala", category: "PLUMBING", contactName: "Victor", phone: "+237 677 55 44 33", email: "vendor@example.test" } });
  await db.vendor.create({ data: { organizationId: org.id, name: "ElecPro Services", category: "ELECTRICAL", phone: "+237 699 12 12 12" } });
  await mk("vendor@example.test", "Victor Vendor", "vendor", { vendorId: vendor.id });

  // Leases: active (from Jan), expiring soon, overdue, commercial
  const today = new Date();
  const y = today.getUTCFullYear();
  const leaseSpecs = [
    { unit: units[0], tenant: tenants[0], start: d(y, 1, 1), end: d(y, 12, 31), rent: "250000" },
    { unit: units[1], tenant: tenants[1], start: d(y - 1, 10, 1), end: new Date(Date.UTC(y, today.getUTCMonth() + 1, 15)), rent: "180000" },
    { unit: units[2], tenant: tenants[2], start: d(y, 2, 15), end: d(y + 1, 2, 14), rent: "250000" },
    { unit: units[3], tenant: tenants[3], start: d(y, 3, 1), end: d(y + 1, 2, 28), rent: "180000" },
    { unit: units[8], tenant: tenants[4], start: d(y, 1, 1), end: d(y + 2, 12, 31), rent: "300000", freq: "QUARTERLY" },
    { unit: units[10], tenant: tenants[5], start: d(y, 4, 1), end: d(y + 1, 3, 31), rent: "200000" },
  ];
  const leases: Awaited<ReturnType<typeof db.lease.create>>[] = [];
  for (const [i, s] of leaseSpecs.entries()) {
    const lease = await db.lease.create({
      data: {
        organizationId: org.id, reference: `LSE-${String(i + 1).padStart(5, "0")}`, unitId: s.unit.id, tenantId: s.tenant.id,
        startDate: s.start, endDate: s.end, moveInDate: s.start, frequency: s.freq ?? "MONTHLY", rentAmount: s.rent,
        serviceCharge: s.freq ? "0" : "15000", depositAmount: String(Number(s.rent) * 2), dueDay: 5, graceDays: 5, createdById: manager.id,
      },
    });
    await submitLease(adminCtx, lease.id);
    await approveAndActivateLease(adminCtx, lease.id);
    leases.push(lease);
  }
  await db.numberSequence.update({ where: { organizationId_key: { organizationId: org.id, key: "LEASE" } }, data: { nextValue: 7 } });
  // A draft lease awaiting completion
  await db.lease.create({ data: { organizationId: org.id, reference: "LSE-00007", unitId: units[4].id, tenantId: tenants[0].id, startDate: d(y + 1, 1, 1), endDate: d(y + 1, 12, 31), rentAmount: "250000", createdById: manager.id } });
  await db.numberSequence.update({ where: { organizationId_key: { organizationId: org.id, key: "LEASE" } }, data: { nextValue: 8 } });

  // Deposits received for most leases
  for (const l of leases.slice(0, 5)) {
    const dep = await db.securityDeposit.findUnique({ where: { leaseId: l.id } });
    if (dep) {
      await db.depositTransaction.create({ data: { depositId: dep.id, type: "RECEIPT", amount: dep.required, description: "Deposit received at move-in", method: "BANK_TRANSFER", createdById: admin.id } });
      await db.securityDeposit.update({ where: { id: dep.id }, data: { status: "HELD", heldIn: "Afriland First Bank — escrow" } });
    }
  }

  // Invoices for everything due up to today (+lead window), then payments.
  // Separation of duties is relaxed while seeding historical payments, then restored.
  await generateDueInvoices(org.id);
  await db.organizationSettings.update({ where: { organizationId: org.id }, data: { separationOfDuties: false } });
  const cashierCtx = { ...adminCtx, user: { ...adminCtx.user, id: cashier.id, name: cashier.name } } as AuthContext;
  const pay = async (tenantIdx: number, amount: string, method: string, confirm = true) => {
    const lease = leases[tenantIdx];
    return recordPayment(confirm ? adminCtx : cashierCtx, { tenantId: tenants[tenantIdx].id, leaseId: lease.id, amount, paymentDate: new Date(), method, confirmNow: confirm, externalRef: method === "MOBILE_MONEY" ? `MOMO-${Date.now()}-${tenantIdx}` : null });
  };
  // Tenant 0 fully paid up to date
  const t0 = await db.invoice.findMany({ where: { tenantId: tenants[0].id, dueDate: { lte: today } } });
  const t0Total = t0.reduce((s, i) => s + Number(i.total), 0);
  if (t0Total > 0) await pay(0, String(t0Total), "BANK_TRANSFER");
  // Tenant 1 (portal demo) partially paid
  const t1 = await db.invoice.findMany({ where: { tenantId: tenants[1].id, dueDate: { lte: today } } });
  const t1Total = t1.reduce((s, i) => s + Number(i.total), 0);
  if (t1Total > 0) await pay(1, String(Math.round(t1Total * 0.7)), "MOBILE_MONEY");
  // Tenant 2 pays nothing (overdue); tenant 3 partial; tenant 4 paid; tenant 5 pending cash payment
  const t3 = await db.invoice.findMany({ where: { tenantId: tenants[3].id, dueDate: { lte: today } } });
  if (t3.length > 1) await pay(3, String(Number(t3[0].total) + Number(t3[1].total) / 2), "CASH");
  const t4 = await db.invoice.findMany({ where: { tenantId: tenants[4].id, dueDate: { lte: today } } });
  if (t4.length) await pay(4, String(t4.reduce((s, i) => s + Number(i.total), 0)), "CHEQUE");
  await db.organizationSettings.update({ where: { organizationId: org.id }, data: { separationOfDuties: true } });
  await pay(5, "100000", "CASH", false);
  await assessOverdueAndLateFees(org.id);

  // Maintenance
  const wo = [
    { title: "Leaking kitchen sink", category: "PLUMBING", priority: "HIGH", status: "ASSIGNED", unit: units[1], tenant: tenants[1], assignedToId: tech.id },
    { title: "Power outage in bedroom", category: "ELECTRICAL", priority: "URGENT", status: "SUBMITTED", unit: units[2], tenant: tenants[2], safetyIssue: true },
    { title: "Repaint stairwell", category: "STRUCTURAL", priority: "LOW", status: "IN_PROGRESS", unit: null, tenant: null, vendorId: vendor.id },
    { title: "Air conditioner not cooling", category: "HVAC", priority: "NORMAL", status: "CLOSED", unit: units[0], tenant: tenants[0], assignedToId: tech.id, rating: 5 },
    { title: "Water heater replacement", category: "PLUMBING", priority: "NORMAL", status: "IN_PROGRESS", unit: units[7], tenant: null, vendorId: vendor.id },
  ];
  for (const [i, w] of wo.entries()) {
    await db.maintenanceRequest.create({
      data: {
        organizationId: org.id, number: `WO-${String(i + 1).padStart(5, "0")}`, propertyId: akwa.id, unitId: w.unit?.id, tenantId: w.tenant?.id,
        reporterId: w.tenant ? tenantUser.id : concierge.id, category: w.category, priority: w.priority, title: w.title,
        description: `${w.title}. Reported via ${w.tenant ? "tenant portal" : "front desk"}.`, status: w.status as never,
        assignedToId: w.assignedToId, vendorId: w.vendorId, safetyIssue: w.safetyIssue ?? false, rating: w.rating,
        closedAt: w.status === "CLOSED" ? new Date() : null, completionSummary: w.status === "CLOSED" ? "Regassed unit and cleaned filters." : "",
        updates: { create: [{ actorName: "System", toStatus: "SUBMITTED", note: "Request submitted" }] },
      },
    });
  }
  await db.numberSequence.update({ where: { organizationId_key: { organizationId: org.id, key: "WORK_ORDER" } }, data: { nextValue: 6 } });

  // Concierge
  await db.visitorLog.createMany({ data: [
    { organizationId: org.id, propertyId: akwa.id, unitId: units[1].id, hostTenantId: tenants[1].id, visitorName: "Paul Biya Jr.", purpose: "Family visit", checkInAt: new Date(Date.now() - 3600_000), loggedById: concierge.id },
    { organizationId: org.id, propertyId: akwa.id, unitId: units[0].id, hostTenantId: tenants[0].id, visitorName: "Canal+ technician", kind: "CONTRACTOR", purpose: "Decoder installation", checkInAt: new Date(Date.now() - 7200_000), checkOutAt: new Date(Date.now() - 3600_000), loggedById: concierge.id },
    { organizationId: org.id, propertyId: akwa.id, unitId: units[2].id, hostTenantId: tenants[2].id, visitorName: "Marie Ngo", purpose: "Dinner", preauthorized: true, expectedAt: new Date(Date.now() + 86_400_000) },
  ] });
  await db.parcel.createMany({ data: [
    { organizationId: org.id, propertyId: akwa.id, unitId: units[1].id, recipientName: "Fatou Ndiaye", carrier: "DHL", trackingNumber: "DHL123456", loggedById: concierge.id },
    { organizationId: org.id, propertyId: akwa.id, unitId: units[0].id, recipientName: "Jean-Paul Mbarga", carrier: "Jumia", collectedAt: new Date(), collectedBy: "Jean-Paul Mbarga", loggedById: concierge.id },
  ] });
  await db.incident.create({ data: { organizationId: org.id, propertyId: akwa.id, title: "Generator failed to start during outage", description: "ENEO outage 21:10; generator started manually at 21:25.", severity: "MEDIUM", reportedById: concierge.id } });
  await db.shiftLog.create({ data: { organizationId: org.id, propertyId: akwa.id, userId: concierge.id, userName: concierge.name, shiftStart: new Date(Date.now() - 8 * 3600_000), shiftEnd: new Date(), notes: "Quiet night. Parcel for 1B at desk.", handoverTo: "Day shift" } });

  // Expenses & announcements
  await db.expense.createMany({ data: [
    { organizationId: org.id, propertyId: akwa.id, vendorId: vendor.id, category: "MAINTENANCE", description: "Plumbing repairs Q1", amount: "85000", expenseDate: d(y, 3, 10), status: "PAID", createdById: admin.id, approvedById: admin.id },
    { organizationId: org.id, propertyId: akwa.id, category: "UTILITIES", description: "Generator fuel", amount: "120000", expenseDate: new Date(), status: "APPROVED", createdById: admin.id, approvedById: admin.id },
    { organizationId: org.id, propertyId: bonapriso.id, category: "SECURITY", description: "Security guard contract", amount: "350000", expenseDate: new Date(), status: "PENDING_APPROVAL", createdById: manager.id },
    { organizationId: org.id, propertyId: bonapriso.id, category: "CLEANING", description: "Common areas cleaning", amount: "60000", expenseDate: d(y, 2, 1), status: "PAID", createdById: admin.id, approvedById: admin.id },
  ] });
  await db.announcement.createMany({ data: [
    { organizationId: org.id, title: "Water interruption on Saturday", body: "CDE maintenance will cut water supply between 08:00 and 14:00. Please store water.", audience: "ALL", pinned: true, createdById: admin.id },
    { organizationId: org.id, propertyId: akwa.id, title: "Generator test every Monday 10:00", body: "Short power interruptions expected during the weekly generator test.", audience: "TENANTS", createdById: manager.id },
  ] });
  await db.message.create({ data: { organizationId: org.id, tenantId: tenants[1].id, fromTenant: false, authorId: manager.id, authorName: manager.name, subject: "Welcome", body: "Welcome to Résidence Akwa! Contact us here for anything you need." } });

  console.log(`Seed complete. Demo password: ${isProd ? "(from SEED_DEMO_PASSWORD)" : DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
