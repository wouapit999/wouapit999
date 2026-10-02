import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import { hashToken, randomToken } from "@/lib/auth/crypto";
import { appBaseUrl, sendEmail } from "@/lib/notify/email";

/** Operator mailbox that approves access requests. */
export function supportEmail() {
  return process.env.SUPPORT_EMAIL || "support@bouquet-innovation.net";
}

export const CODE_TTL_MINUTES = 20;
const APPROVAL_TTL_HOURS = 72;
const MAX_CODE_ATTEMPTS = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 5;

export interface AccessRequestInput {
  email: string;
  name: string;
  orgName: string;
  locale: "en" | "fr";
  ip: string | null;
}

/**
 * Step 1 — the applicant asks for access. The operator receives the applicant's details with
 * approve/reject links. Nothing is sent to the applicant yet.
 */
export async function requestAccess(input: AccessRequestInput) {
  const email = input.email.trim().toLowerCase();
  const since = new Date(Date.now() - 3600_000);
  if (input.ip) {
    const recent = await db.signupRequest.count({ where: { ip: input.ip, createdAt: { gte: since } } });
    if (recent >= MAX_REQUESTS_PER_IP_PER_HOUR) throw new BusinessError("signup.rateLimited");
  }
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new BusinessError("setup.emailTaken");
  // One live request per email: re-requesting supersedes the previous pending one.
  await db.signupRequest.updateMany({ where: { email, status: "PENDING" }, data: { status: "EXPIRED" } });
  const approvalToken = randomToken();
  const req = await db.signupRequest.create({
    data: {
      email,
      name: input.name.trim(),
      orgName: input.orgName.trim(),
      approvalTokenHash: hashToken(approvalToken),
      approvalExpiresAt: new Date(Date.now() + APPROVAL_TTL_HOURS * 3600_000),
      ip: input.ip,
      locale: input.locale,
    },
  });
  const base = appBaseUrl();
  const approveUrl = `${base}/signup/approve/${approvalToken}`;
  const mail = await sendEmail({
    to: supportEmail(),
    subject: `GestPro — access request from ${req.name} <${req.email}>`,
    text: [
      "A new enterprise access request was submitted on GestPro.",
      "",
      `Name:        ${req.name}`,
      `Email:       ${req.email}`,
      `Enterprise:  ${req.orgName}`,
      `Received:    ${req.createdAt.toISOString()}`,
      `From IP:     ${req.ip ?? "unknown"}`,
      "",
      `To grant access (sends a one-time code to the applicant, valid ${CODE_TTL_MINUTES} minutes):`,
      approveUrl,
      "",
      `This link expires in ${APPROVAL_TTL_HOURS} hours. If you do not recognise this request, ignore it: nothing is created without approval.`,
    ].join("\n"),
    fromName: "GestPro",
  });
  await audit(null, {
    action: "signup.requested",
    module: "signup",
    entityType: "SignupRequest",
    entityId: req.id,
    metadata: { email: req.email, orgName: req.orgName, operatorNotified: mail.sent },
  });
  return { id: req.id, operatorNotified: mail.sent };
}

export async function findByApprovalToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const req = await db.signupRequest.findUnique({ where: { approvalTokenHash: hashToken(token) } });
  if (!req) return null;
  return req;
}

function generateCode() {
  // 8 digits, grouped as 1234-5678: easy to read out on the phone, ~27 bits with 5 attempts allowed.
  const n = randomInt(0, 100_000_000).toString().padStart(8, "0");
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

export function normalizeCode(code: string) {
  return code.replace(/\D/g, "").slice(0, 8);
}

/**
 * Step 2 — the operator approves: a one-time code is created, valid CODE_TTL_MINUTES from now,
 * emailed to the applicant and returned so the operator can also pass it on by other means.
 */
export async function approveRequest(requestId: string, approvedBy: string) {
  const req = await db.signupRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new BusinessError("signup.notFound");
  if (req.status === "USED") throw new BusinessError("signup.alreadyUsed");
  if (req.status === "REJECTED") throw new BusinessError("signup.alreadyRejected");
  if (req.approvalExpiresAt < new Date() && req.status === "PENDING") throw new BusinessError("signup.approvalExpired");
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await db.signupRequest.update({
    where: { id: req.id },
    data: { status: "APPROVED", codeHash: hashToken(normalizeCode(code)), codeExpiresAt: expiresAt, codeAttempts: 0, approvedAt: new Date(), approvedBy },
  });
  const fr = req.locale === "fr";
  const verifyUrl = `${appBaseUrl()}/signup/verify?email=${encodeURIComponent(req.email)}`;
  const mail = await sendEmail({
    to: req.email,
    subject: fr ? "Votre code d'accès GestPro" : "Your GestPro access code",
    text: fr
      ? `Bonjour ${req.name},\n\nVotre demande d'accès pour « ${req.orgName} » a été approuvée.\n\nCode d'accès : ${code}\nValable ${CODE_TTL_MINUTES} minutes, à usage unique.\n\nSaisissez-le ici pour créer votre entreprise : ${verifyUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`
      : `Hello ${req.name},\n\nYour access request for "${req.orgName}" has been approved.\n\nAccess code: ${code}\nValid for ${CODE_TTL_MINUTES} minutes, single use.\n\nEnter it here to create your enterprise: ${verifyUrl}\n\nIf you did not request this, ignore this email.`,
    fromName: "GestPro",
  });
  await audit(null, {
    action: "signup.approved",
    module: "signup",
    entityType: "SignupRequest",
    entityId: req.id,
    metadata: { email: req.email, approvedBy, codeEmailed: mail.sent, expiresAt },
  });
  return { code, expiresAt, emailed: mail.sent, email: req.email };
}

export async function rejectRequest(requestId: string, rejectedBy: string) {
  const req = await db.signupRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new BusinessError("signup.notFound");
  if (req.status === "USED") throw new BusinessError("signup.alreadyUsed");
  await db.signupRequest.update({ where: { id: req.id }, data: { status: "REJECTED" } });
  await audit(null, { action: "signup.rejected", module: "signup", entityType: "SignupRequest", entityId: req.id, metadata: { email: req.email, rejectedBy } });
}

/**
 * Step 3 — the applicant enters email + code. On success a short-lived verification token is
 * issued (cookie) that the completion form must present. Generic error for every failure mode.
 */
export async function verifyCode(emailInput: string, codeInput: string) {
  const email = emailInput.trim().toLowerCase();
  const code = normalizeCode(codeInput);
  const req = await db.signupRequest.findFirst({ where: { email, status: "APPROVED" }, orderBy: { approvedAt: "desc" } });
  if (!req || !req.codeHash || !req.codeExpiresAt) throw new BusinessError("signup.codeInvalid");
  if (req.codeAttempts >= MAX_CODE_ATTEMPTS) throw new BusinessError("signup.codeInvalid");
  if (req.codeExpiresAt < new Date()) {
    await db.signupRequest.update({ where: { id: req.id }, data: { status: "EXPIRED" } });
    throw new BusinessError("signup.codeExpired");
  }
  if (code.length !== 8 || hashToken(code) !== req.codeHash) {
    await db.signupRequest.update({ where: { id: req.id }, data: { codeAttempts: { increment: 1 } } });
    throw new BusinessError("signup.codeInvalid");
  }
  const verifyToken = randomToken();
  await db.signupRequest.update({
    where: { id: req.id },
    data: { verifyTokenHash: hashToken(verifyToken), verifyExpiresAt: req.codeExpiresAt },
  });
  await audit(null, { action: "signup.code_verified", module: "signup", entityType: "SignupRequest", entityId: req.id, metadata: { email } });
  return { verifyToken, request: req };
}

/** Loads the request behind a verification cookie; null when missing, used or expired. */
export async function findVerified(verifyToken: string | undefined) {
  if (!verifyToken || !/^[A-Za-z0-9_-]{20,}$/.test(verifyToken)) return null;
  const req = await db.signupRequest.findUnique({ where: { verifyTokenHash: hashToken(verifyToken) } });
  if (!req || req.status !== "APPROVED" || !req.verifyExpiresAt || req.verifyExpiresAt < new Date()) return null;
  return req;
}

export async function listRequests(limit = 50) {
  return db.signupRequest.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
export const SIGNUP_COOKIE = "rf_signup";
