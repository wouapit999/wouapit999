-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvalTokenHash" TEXT NOT NULL,
    "approvalExpiresAt" TIMESTAMP(3) NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifyTokenHash" TEXT,
    "verifyExpiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "organizationId" TEXT,
    "ip" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupRequest_approvalTokenHash_key" ON "SignupRequest"("approvalTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SignupRequest_verifyTokenHash_key" ON "SignupRequest"("verifyTokenHash");

-- CreateIndex
CREATE INDEX "SignupRequest_email_createdAt_idx" ON "SignupRequest"("email", "createdAt");

-- CreateIndex
CREATE INDEX "SignupRequest_status_createdAt_idx" ON "SignupRequest"("status", "createdAt");
