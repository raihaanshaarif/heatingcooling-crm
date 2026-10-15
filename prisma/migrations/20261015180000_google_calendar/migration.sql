-- CreateEnum
CREATE TYPE "GoogleCalendarTaskKind" AS ENUM ('SYNC_JOB', 'RESYNC_USER');

-- CreateEnum
CREATE TYPE "GoogleCalendarTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GoogleCalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiry" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarTask" (
    "id" TEXT NOT NULL,
    "kind" "GoogleCalendarTaskKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "status" "GoogleCalendarTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarConnection_userId_key" ON "GoogleCalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_jobId_idx" ON "GoogleCalendarEvent"("jobId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_userId_startsAt_idx" ON "GoogleCalendarEvent"("userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_userId_jobId_key" ON "GoogleCalendarEvent"("userId", "jobId");

-- CreateIndex
CREATE INDEX "GoogleCalendarTask_status_nextAttemptAt_idx" ON "GoogleCalendarTask"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "GoogleCalendarTask_userId_jobId_idx" ON "GoogleCalendarTask"("userId", "jobId");

-- CreateIndex
CREATE INDEX "GoogleCalendarTask_createdAt_idx" ON "GoogleCalendarTask"("createdAt");

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarTask" ADD CONSTRAINT "GoogleCalendarTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

