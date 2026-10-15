-- CreateEnum
CREATE TYPE "XeroSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "XeroJobKind" AS ENUM ('CONTACT', 'INVOICE', 'VOID_INVOICE', 'CREDIT_NOTE', 'PAYMENT', 'DELETE_PAYMENT');

-- CreateEnum
CREATE TYPE "XeroJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "xeroSettings" JSONB,
ADD COLUMN     "xeroTenantId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "xeroContactId" TEXT,
ADD COLUMN     "xeroSyncError" TEXT,
ADD COLUMN     "xeroSyncStatus" "XeroSyncStatus",
ADD COLUMN     "xeroSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "xeroCreditNoteId" TEXT,
ADD COLUMN     "xeroSyncError" TEXT,
ADD COLUMN     "xeroSyncStatus" "XeroSyncStatus",
ADD COLUMN     "xeroSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "xeroInvoiceId" TEXT,
ADD COLUMN     "xeroSyncError" TEXT,
ADD COLUMN     "xeroSyncStatus" "XeroSyncStatus",
ADD COLUMN     "xeroSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "xeroPaymentId" TEXT,
ADD COLUMN     "xeroSyncError" TEXT,
ADD COLUMN     "xeroSyncStatus" "XeroSyncStatus",
ADD COLUMN     "xeroSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "XeroConnection" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tenantId" TEXT,
    "tenantName" TEXT,
    "tenants" JSONB,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiry" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedById" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroSyncJob" (
    "id" TEXT NOT NULL,
    "kind" "XeroJobKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "payload" JSONB,
    "label" TEXT NOT NULL,
    "status" "XeroJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XeroSyncJob_status_nextAttemptAt_idx" ON "XeroSyncJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "XeroSyncJob_invoiceId_idx" ON "XeroSyncJob"("invoiceId");

-- CreateIndex
CREATE INDEX "XeroSyncJob_kind_entityId_idx" ON "XeroSyncJob"("kind", "entityId");

-- CreateIndex
CREATE INDEX "XeroSyncJob_createdAt_idx" ON "XeroSyncJob"("createdAt");

-- CreateIndex
CREATE INDEX "Client_xeroContactId_idx" ON "Client"("xeroContactId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_xeroCreditNoteId_key" ON "CreditNote"("xeroCreditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_xeroInvoiceId_key" ON "Invoice"("xeroInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_xeroPaymentId_key" ON "Payment"("xeroPaymentId");

