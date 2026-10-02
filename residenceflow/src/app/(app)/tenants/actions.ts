"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, can } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { maskId } from "@/lib/format";
import { storeDocument } from "@/lib/storage";
import { getT, makeT } from "@/i18n";
import { invitePortalUser, loadScopedTenant, resendPortalActivation } from "@/services/tenants";
import { boolField, emailField, idField, optDayField, stringList } from "../leases/fields";
import { COMM_PREFS, CONTACT_KINDS, ID_TYPES, PORTAL_ROLES, TENANT_STATUSES, TENANT_TYPES, tenantMessages } from "./messages";

const tenantSchema = z.object({
  type: z.enum(TENANT_TYPES).default("INDIVIDUAL"),
  legalName: z.string().trim().min(2).max(200),
  preferredName: z.string().trim().max(200).default(""),
  email: emailField.default(""),
  phone: z.string().trim().max(40).default(""),
  altPhone: z.string().trim().max(40).default(""),
  postalAddress: z.string().trim().max(500).default(""),
  previousAddress: z.string().trim().max(500).default(""),
  idType: z.union([z.literal(""), z.enum(ID_TYPES)]).default(""),
  // Raw ID number: only used to compute the masked value, never stored or logged.
  idNumber: z.string().trim().max(60).default(""),
  idIssueDate: optDayField,
  idExpiryDate: optDayField,
  employer: z.string().trim().max(200).default(""),
  language: z.enum(["fr", "en"]).default("fr"),
  commPreferences: stringList(COMM_PREFS),
  notes: z.string().trim().max(8000).default(""),
  status: z.enum(TENANT_STATUSES).default("ACTIVE"),
});

function profileData(d: z.infer<typeof tenantSchema>) {
  return {
    type: d.type,
    legalName: d.legalName,
    preferredName: d.preferredName,
    email: d.email.toLowerCase(),
    phone: d.phone,
    altPhone: d.altPhone,
    postalAddress: d.postalAddress,
    previousAddress: d.previousAddress,
    idType: d.idType,
    idIssueDate: d.idIssueDate,
    idExpiryDate: d.idExpiryDate,
    employer: d.employer,
    language: d.language,
    commPreferences: d.commPreferences,
    status: d.status,
  };
}

export async function createTenantAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("tenant.create");
    const d = tenantSchema.parse(formToObject(fd));
    const data = {
      ...profileData(d),
      idNumberMasked: d.idNumber ? maskId(d.idNumber) : "",
      notes: can(ctx, "tenant.notes.view") ? d.notes : "",
    };
    const created = await db.$transaction(async (tx) => {
      const reference = await nextNumber(ctx.organizationId, "TENANT", tx);
      const tnt = await tx.tenant.create({ data: { ...data, reference, organizationId: ctx.organizationId } });
      await audit(ctx, { action: "tenant.created", module: "tenants", entityType: "Tenant", entityId: tnt.id, after: { ...data, notes: undefined } }, tx);
      return tnt;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/tenants");
  redirect(`/tenants/${id}`);
}

export async function updateTenantAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("tenant.update");
    const { t } = await getT(tenantMessages);
    const before = await loadScopedTenant(ctx, idField.parse(id));
    if (!before) throw new BusinessError(t("tenant.err.notFound"));
    const d = tenantSchema.parse(formToObject(fd));
    const data = {
      ...profileData(d),
      // Blank ID number keeps the stored masked value.
      ...(d.idNumber ? { idNumberMasked: maskId(d.idNumber) } : {}),
      ...(can(ctx, "tenant.notes.view") ? { notes: d.notes } : {}),
    };
    await db.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: before.id }, data });
      await audit(ctx, {
        action: "tenant.updated",
        module: "tenants",
        entityType: "Tenant",
        entityId: before.id,
        before: { ...before, notes: undefined },
        after: { ...data, notes: undefined },
        metadata: { notesChanged: "notes" in data && data.notes !== before.notes, idChanged: !!d.idNumber },
      }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath(`/tenants/${id}`);
  redirect(`/tenants/${id}`);
}

const contactSchema = z.object({
  tenantId: idField,
  kind: z.enum(CONTACT_KINDS),
  name: z.string().trim().min(2).max(200),
  relationship: z.string().trim().max(100).default(""),
  phone: z.string().trim().max(40).default(""),
  email: emailField.default(""),
});

export async function addContactAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(tenantMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("tenant.update");
    const input = contactSchema.parse(formToObject(fd));
    const tenant = await loadScopedTenant(ctx, input.tenantId);
    if (!tenant) throw new BusinessError(t("tenant.err.notFound"));
    const { tenantId: _tid, ...data } = input;
    void _tid;
    await db.$transaction(async (tx) => {
      const c = await tx.tenantContact.create({ data: { ...data, email: data.email.toLowerCase(), tenantId: tenant.id } });
      await audit(ctx, { action: "tenant.contact_added", module: "tenants", entityType: "TenantContact", entityId: c.id, metadata: { tenantId: tenant.id, kind: c.kind }, after: data }, tx);
    });
    revalidatePath(`/tenants/${tenant.id}`);
  });
  return r.ok ? { ...r, message: t("tenant.contact.added") } : r;
}

export async function removeContactAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(tenantMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("tenant.update");
    const tenantId = idField.parse(fd.get("tenantId"));
    const contactId = idField.parse(fd.get("contactId"));
    const tenant = await loadScopedTenant(ctx, tenantId);
    if (!tenant) throw new BusinessError(t("tenant.err.notFound"));
    const contact = await db.tenantContact.findFirst({ where: { id: contactId, tenantId: tenant.id } });
    if (!contact) throw new BusinessError(t("tenant.err.contactNotFound"));
    await db.$transaction(async (tx) => {
      await tx.tenantContact.delete({ where: { id: contact.id } });
      await audit(ctx, { action: "tenant.contact_removed", module: "tenants", entityType: "TenantContact", entityId: contact.id, metadata: { tenantId: tenant.id }, before: contact }, tx);
    });
    revalidatePath(`/tenants/${tenant.id}`);
  });
  return r.ok ? { ...r, message: t("tenant.contact.removed") } : r;
}

export async function uploadTenantDocumentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(tenantMessages);
  const r = await runAction(async () => {
    const ctx = await authorize(["tenant.view", "document.upload"]);
    const tenantId = idField.parse(fd.get("tenantId"));
    const meta = z
      .object({ name: z.string().trim().max(200).default(""), visibleToTenant: boolField, sensitive: boolField })
      .parse({ name: fd.get("name") ?? "", visibleToTenant: fd.get("visibleToTenant"), sensitive: fd.get("sensitive") });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BusinessError(t("tenant.err.fileRequired"));
    const tenant = await loadScopedTenant(ctx, tenantId);
    if (!tenant) throw new BusinessError(t("tenant.err.notFound"));
    await storeDocument(ctx, {
      file,
      category: "TENANT",
      name: meta.name || undefined,
      tenantId: tenant.id,
      // Sensitive documents are never exposed in the portal.
      visibleToTenant: meta.visibleToTenant && !meta.sensitive,
      sensitive: meta.sensitive,
    });
    revalidatePath(`/tenants/${tenant.id}`);
  });
  return r.ok ? { ...r, message: t("tenant.uploaded") } : r;
}

const inviteSchema = z.object({
  tenantId: idField,
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().min(3).max(200).refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email"),
  roleKey: z.enum(PORTAL_ROLES),
});

export async function invitePortalUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const { t } = await getT(tenantMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("users.manage");
    const input = inviteSchema.parse(formToObject(fd));
    const tenant = await loadScopedTenant(ctx, input.tenantId);
    const emailT = makeT(tenant?.language === "en" ? "en" : "fr", tenantMessages);
    const res = await invitePortalUser(ctx, input, t, emailT);
    revalidatePath(`/tenants/${input.tenantId}`);
    return res;
  });
  return r.ok ? { ...r, message: t("tenant.portal.invited") } : r;
}

export async function resendActivationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const { t } = await getT(tenantMessages);
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const tenantId = idField.parse(fd.get("tenantId"));
    const userId = idField.parse(fd.get("userId"));
    const tenant = await loadScopedTenant(ctx, tenantId);
    const emailT = makeT(tenant?.language === "en" ? "en" : "fr", tenantMessages);
    return resendPortalActivation(ctx, { tenantId, userId }, t, emailT);
  });
}
