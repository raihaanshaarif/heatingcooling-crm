-- CreateEnum
CREATE TYPE "SmsKind" AS ENUM ('ON_MY_WAY', 'APPOINTMENT_REMINDER', 'SERVICE_DUE', 'INVOICE_OVERDUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('SENT', 'LOGGED', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'APPOINTMENT_REMINDER';

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "smsSettings" JSONB;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "noSms" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "kind" "SmsKind" NOT NULL,
    "status" "SmsStatus" NOT NULL,
    "to" TEXT,
    "rawPhone" TEXT,
    "body" TEXT NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "clientId" TEXT,
    "jobId" TEXT,
    "invoiceId" TEXT,
    "maintenancePlanId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_clientId_createdAt_idx" ON "SmsMessage"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_jobId_idx" ON "SmsMessage"("jobId");

-- CreateIndex
CREATE INDEX "SmsMessage_createdAt_idx" ON "SmsMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

