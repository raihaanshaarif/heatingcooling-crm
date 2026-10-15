-- CreateEnum
CREATE TYPE "GeocodeSource" AS ENUM ('GOOGLE', 'SUBURB', 'SEED');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'ROUTE_PLAN';

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "depotGeocodeError" TEXT,
ADD COLUMN     "depotGeocodeSource" "GeocodeSource",
ADD COLUMN     "depotLat" DOUBLE PRECISION,
ADD COLUMN     "depotLng" DOUBLE PRECISION,
ADD COLUMN     "routeDayStart" TEXT NOT NULL DEFAULT '07:00';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "timeFixed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "geocodeError" TEXT,
ADD COLUMN     "geocodeSource" "GeocodeSource",
ADD COLUMN     "geocodedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "homeGeocodeSource" "GeocodeSource",
ADD COLUMN     "homeLat" DOUBLE PRECISION,
ADD COLUMN     "homeLng" DOUBLE PRECISION,
ADD COLUMN     "routeFromHome" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RoutePlan" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "appliedById" TEXT,
    "provider" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "applied" JSONB NOT NULL,
    "beforeKm" DOUBLE PRECISION NOT NULL,
    "afterKm" DOUBLE PRECISION NOT NULL,
    "beforeMinutes" INTEGER NOT NULL,
    "afterMinutes" INTEGER NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutePlan_technicianId_date_idx" ON "RoutePlan"("technicianId", "date");

-- AddForeignKey
ALTER TABLE "RoutePlan" ADD CONSTRAINT "RoutePlan_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlan" ADD CONSTRAINT "RoutePlan_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

