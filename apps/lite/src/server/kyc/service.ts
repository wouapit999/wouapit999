import { z } from 'zod';

import type { KycTier } from '@/generated/prisma/enums';

import { writeAudit } from '../audit';
import { sha256Hex } from '../crypto';
import { type Prisma, db } from '../db';
import { AppError } from '../errors';
import { notify, notifyRoles } from '../notifications';
import {
  type ActionContext,
  actorUserId,
  assertPermission,
  hasPermission,
  requireUserActor,
} from '../rbac';
import { getSetting } from '../settings';
import { getKycProvider, selectKycVendor } from './vendors';

/**
 * KYC cases (phase 2): submission with document upload (≤ 1 MB each, stored as bytea with a
 * sha256), simulated vendor verification, tier upgrade, and the back-office review queue.
 */

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const KYC_ID_TYPES = [
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVERS_LICENSE',
  'VOTER_CARD',
  'RESIDENCE_PERMIT',
] as const;
export const KYC_DOCUMENT_KINDS = ['ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS'] as const;

export const KYC_TIER_INFO: Readonly<
  Record<KycTier, { label: string; description: string; requires: string }>
> = {
  TIER_0: {
    label: 'Tier 0 — Registered',
    description: 'Small domestic transfers only.',
    requires: 'E-mail and password',
  },
  TIER_1: {
    label: 'Tier 1 — Verified',
    description: 'Higher limits and international transfers.',
    requires: 'Government ID (front)',
  },
  TIER_2: {
    label: 'Tier 2 — Enhanced',
    description: 'Highest limits.',
    requires: 'Government ID and proof of address',
  },
};

const TIER_RANK: Record<KycTier, number> = { TIER_0: 0, TIER_1: 1, TIER_2: 2 };

export interface KycDocumentUpload {
  readonly kind: (typeof KYC_DOCUMENT_KINDS)[number];
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
}

const MAGIC: ReadonlyArray<{ mime: string; test: (bytes: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45,
  },
  {
    mime: 'application/pdf',
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
];

/** Content sniffing: the declared MIME type must match the file's magic bytes. */
export function sniffDocumentType(data: Uint8Array): string | null {
  return MAGIC.find((entry) => entry.test(data))?.mime ?? null;
}

function validateDocument(document: KycDocumentUpload): void {
  if (document.data.byteLength === 0) {
    throw new AppError('VALIDATION', `${document.fileName || 'Document'} is empty`);
  }
  if (document.data.byteLength > MAX_DOCUMENT_BYTES) {
    throw new AppError('VALIDATION', `${document.fileName || 'Document'} is larger than 1 MB`);
  }
  const sniffed = sniffDocumentType(document.data);
  if (!sniffed || !(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(sniffed)) {
    throw new AppError('VALIDATION', 'Documents must be JPEG, PNG, WebP or PDF files');
  }
  if (sniffed !== document.mimeType) {
    throw new AppError('VALIDATION', 'The file content does not match its type');
  }
}

export const kycSubmissionSchema = z.object({
  targetTier: z.enum(['TIER_1', 'TIER_2']),
  idType: z.enum(KYC_ID_TYPES),
  idNumber: z
    .string()
    .trim()
    .min(4, 'Enter the document number')
    .max(40)
    .regex(/^[A-Za-z0-9 /-]+$/, 'Letters, digits, spaces, dashes and slashes only'),
  idCountry: z.string().trim().toUpperCase().length(2, 'Choose the issuing country'),
});
export type KycSubmissionInput = z.infer<typeof kycSubmissionSchema>;

const CASE_SELECT = {
  id: true,
  userId: true,
  status: true,
  targetTier: true,
  vendor: true,
  vendorRef: true,
  vendorDecision: true,
  vendorScore: true,
  vendorResult: true,
  idType: true,
  idNumber: true,
  idCountry: true,
  reviewerId: true,
  reviewNote: true,
  submittedAt: true,
  decidedAt: true,
  documents: {
    select: {
      id: true,
      kind: true,
      fileName: true,
      mimeType: true,
      size: true,
      sha256: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.KycCaseSelect;

/**
 * Submits a KYC case for the signed-in customer: validates and stores the documents, runs the
 * (simulated) vendor check and applies its decision — APPROVE upgrades the tier when
 * `kyc.autoApprove` is on, REVIEW queues the case for the back office, REJECT closes it.
 */
export async function submitKycCase(
  ctx: ActionContext,
  input: KycSubmissionInput,
  documents: readonly KycDocumentUpload[],
) {
  const actor = requireUserActor(ctx);
  const data = kycSubmissionSchema.parse(input);
  if (documents.length === 0 || documents.length > 4) {
    throw new AppError('VALIDATION', 'Upload between one and four documents');
  }
  documents.forEach(validateDocument);
  if (!documents.some((document) => document.kind === 'ID_FRONT')) {
    throw new AppError('VALIDATION', 'Upload the front of your ID document');
  }
  if (
    data.targetTier === 'TIER_2' &&
    !documents.some((document) => document.kind === 'PROOF_OF_ADDRESS')
  ) {
    throw new AppError('VALIDATION', 'Tier 2 requires a proof of address');
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (TIER_RANK[user.kycTier] >= TIER_RANK[data.targetTier]) {
    throw new AppError('INVALID_STATE', 'You are already verified at this tier');
  }
  const open = await db.kycCase.count({
    where: { userId: actor.id, status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
  });
  if (open > 0) throw new AppError('CONFLICT', 'You already have a verification in progress');

  const [autoApprove, defaultVendor] = await Promise.all([
    getSetting('kyc.autoApprove'),
    getSetting('kyc.defaultVendor'),
  ]);
  const vendorKey = selectKycVendor(data.idType, data.idCountry, defaultVendor);
  const vendor = getKycProvider(vendorKey);
  const hashed = documents.map((document) => ({ ...document, sha256: sha256Hex(document.data) }));

  return db.$transaction(async (tx) => {
    const created = await tx.kycCase.create({
      data: {
        userId: actor.id,
        status: 'SUBMITTED',
        targetTier: data.targetTier,
        vendor: vendorKey,
        idType: data.idType,
        idNumber: data.idNumber,
        idCountry: data.idCountry,
        documents: {
          create: hashed.map((document) => ({
            userId: actor.id,
            kind: document.kind,
            fileName: document.fileName.slice(0, 200) || 'document',
            mimeType: document.mimeType,
            size: document.data.byteLength,
            sha256: document.sha256,
            data: new Uint8Array(document.data),
          })),
        },
      },
      select: { id: true },
    });

    const result = await vendor.verify({
      caseId: created.id,
      fullName: user.fullName,
      idType: data.idType,
      idNumber: data.idNumber,
      idCountry: data.idCountry,
      documents: hashed.map((document) => ({
        kind: document.kind,
        sha256: document.sha256,
        size: document.data.byteLength,
        mimeType: document.mimeType,
      })),
    });

    const approved = result.decision === 'APPROVE' && autoApprove;
    const status = approved ? 'APPROVED' : result.decision === 'REJECT' ? 'REJECTED' : 'IN_REVIEW';
    const now = new Date();
    const kycCase = await tx.kycCase.update({
      where: { id: created.id },
      data: {
        status,
        vendorRef: result.vendorRef,
        vendorDecision: result.decision,
        vendorScore: result.score,
        vendorResult: {
          checks: result.checks,
          simulated: result.simulated,
        } as unknown as Prisma.InputJsonValue,
        decidedAt: status === 'IN_REVIEW' ? null : now,
        reviewNote: approved
          ? `Automatically approved on ${vendor.name} decision`
          : status === 'REJECTED'
            ? `Rejected on ${vendor.name} decision`
            : null,
      },
      select: CASE_SELECT,
    });

    await tx.user.update({
      where: { id: actor.id },
      data: approved
        ? { kycTier: data.targetTier, kycStatus: 'VERIFIED' }
        : { kycStatus: status === 'REJECTED' ? 'REJECTED' : 'PENDING' },
    });

    await notify(tx, {
      userId: actor.id,
      type: `kyc.${status.toLowerCase()}`,
      title:
        status === 'APPROVED'
          ? 'Identity verified'
          : status === 'REJECTED'
            ? 'Verification unsuccessful'
            : 'Verification under review',
      body:
        status === 'APPROVED'
          ? `You are now ${KYC_TIER_INFO[data.targetTier].label}. Your limits have been raised.`
          : status === 'REJECTED'
            ? 'We could not verify your document. You can submit it again.'
            : 'Our compliance team is reviewing your documents.',
      href: '/app/kyc',
    });
    if (status === 'IN_REVIEW') {
      await notifyRoles(tx, ['COMPLIANCE', 'ADMIN'], {
        type: 'kyc.queue',
        title: 'KYC case awaiting review',
        body: `${user.fullName} (${user.email}) — ${data.targetTier.replace('_', ' ')}`,
        href: `/admin/kyc/${created.id}`,
      });
    }
    await writeAudit(tx, ctx, {
      action: 'kyc.submit',
      resourceType: 'kyc_case',
      resourceId: created.id,
      after: {
        status,
        targetTier: data.targetTier,
        vendor: vendorKey,
        vendorDecision: result.decision,
        documents: hashed.map((document) => ({ kind: document.kind, sha256: document.sha256 })),
      },
    });
    return kycCase;
  });
}

/** The signed-in customer's own cases, newest first (documents as metadata, no bytes). */
export async function listMyKycCases(ctx: ActionContext) {
  const actor = requireUserActor(ctx);
  return db.kycCase.findMany({
    where: { userId: actor.id },
    orderBy: { submittedAt: 'desc' },
    select: CASE_SELECT,
  });
}

/** One case: the owner, or staff with `kyc:read`. */
export async function getKycCase(ctx: ActionContext, caseId: string) {
  const kycCase = await db.kycCase.findUnique({
    where: { id: caseId },
    select: {
      ...CASE_SELECT,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          countryCode: true,
          kycTier: true,
          kycStatus: true,
          riskLevel: true,
          riskScore: true,
          dateOfBirth: true,
          createdAt: true,
        },
      },
    },
  });
  const isOwner = ctx.actor.type === 'USER' && kycCase?.userId === ctx.actor.id;
  if (!kycCase || !(isOwner || hasPermission(ctx, 'kyc:read'))) {
    throw new AppError('NOT_FOUND', 'KYC case not found');
  }
  return kycCase;
}

/**
 * Document bytes: the owner, or staff with `kyc:review` (each staff download is audited).
 * Serve with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
 */
export async function getKycDocument(ctx: ActionContext, documentId: string) {
  const document = await db.kycDocument.findUnique({ where: { id: documentId } });
  const isOwner = ctx.actor.type === 'USER' && document?.userId === ctx.actor.id;
  if (!document || !(isOwner || hasPermission(ctx, 'kyc:review'))) {
    throw new AppError('NOT_FOUND', 'Document not found');
  }
  if (!isOwner) {
    await writeAudit(db, ctx, {
      action: 'kyc.document.view',
      resourceType: 'kyc_document',
      resourceId: document.id,
      metadata: { caseId: document.caseId, subjectUserId: document.userId },
    });
  }
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    size: document.size,
    sha256: document.sha256,
    data: document.data,
  };
}

/** Back-office verification queue. Requires `kyc:read`. */
export async function listKycCases(
  ctx: ActionContext,
  filter: {
    status?: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESUBMIT_REQUESTED';
    page?: number;
    pageSize?: number;
  } = {},
) {
  assertPermission(ctx, 'kyc:read');
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const where: Prisma.KycCaseWhereInput = filter.status ? { status: filter.status } : {};
  const [items, total] = await Promise.all([
    db.kycCase.findMany({
      where,
      orderBy: { submittedAt: filter.status === 'IN_REVIEW' ? 'asc' : 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        targetTier: true,
        vendor: true,
        vendorDecision: true,
        vendorScore: true,
        idType: true,
        idCountry: true,
        submittedAt: true,
        decidedAt: true,
        user: {
          select: { id: true, email: true, fullName: true, countryCode: true, riskLevel: true },
        },
      },
    }),
    db.kycCase.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export const kycReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'RESUBMIT']),
  note: z.string().trim().min(3, 'Explain the decision').max(1000),
});

/** Back-office decision on a case that is IN_REVIEW. Requires `kyc:review`. */
export async function reviewKycCase(
  ctx: ActionContext,
  caseId: string,
  input: z.infer<typeof kycReviewSchema>,
) {
  assertPermission(ctx, 'kyc:review');
  const data = kycReviewSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM kyc_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
    const before = await tx.kycCase.findUnique({ where: { id: caseId }, include: { user: true } });
    if (!before) throw new AppError('NOT_FOUND', 'KYC case not found');
    if (before.status !== 'IN_REVIEW' && before.status !== 'SUBMITTED') {
      throw new AppError('INVALID_STATE', 'This case has already been decided');
    }
    const status =
      data.decision === 'APPROVE'
        ? 'APPROVED'
        : data.decision === 'REJECT'
          ? 'REJECTED'
          : 'RESUBMIT_REQUESTED';
    const after = await tx.kycCase.update({
      where: { id: caseId },
      data: { status, reviewerId: actorUserId(ctx), reviewNote: data.note, decidedAt: new Date() },
      select: CASE_SELECT,
    });
    const upgraded =
      status === 'APPROVED' && TIER_RANK[before.targetTier] > TIER_RANK[before.user.kycTier];
    await tx.user.update({
      where: { id: before.userId },
      data:
        status === 'APPROVED'
          ? { kycStatus: 'VERIFIED', ...(upgraded ? { kycTier: before.targetTier } : {}) }
          : // A failed upgrade attempt does not downgrade an already-verified customer.
            before.user.kycTier === 'TIER_0'
            ? { kycStatus: status === 'REJECTED' ? 'REJECTED' : 'NONE' }
            : { kycStatus: 'VERIFIED' },
    });
    await notify(tx, {
      userId: before.userId,
      type: `kyc.${status.toLowerCase()}`,
      title:
        status === 'APPROVED'
          ? 'Identity verified'
          : status === 'REJECTED'
            ? 'Verification unsuccessful'
            : 'Please resubmit your documents',
      body:
        status === 'APPROVED'
          ? `You are now ${KYC_TIER_INFO[before.targetTier].label}.`
          : data.note,
      href: '/app/kyc',
    });
    await writeAudit(tx, ctx, {
      action: `kyc.review.${data.decision.toLowerCase()}`,
      resourceType: 'kyc_case',
      resourceId: caseId,
      before: { status: before.status, kycTier: before.user.kycTier },
      after: {
        status,
        kycTier: upgraded ? before.targetTier : before.user.kycTier,
        note: data.note,
      },
    });
    return after;
  });
}
