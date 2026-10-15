-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('WAREHOUSE', 'VAN');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVE', 'TRANSFER', 'ADJUST', 'JOB_USE', 'JOB_RETURN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'SUPPLIER';
ALTER TYPE "EntityType" ADD VALUE 'INVENTORY_ITEM';
ALTER TYPE "EntityType" ADD VALUE 'STOCK_RECEIPT';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StockLocationType" NOT NULL DEFAULT 'VAN',
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "locationId" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "unitCostCents" INTEGER,
    "reason" TEXT,
    "jobId" TEXT,
    "jobLineItemId" TEXT,
    "receiptId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_userId_key" ON "StockLocation"("userId");

-- CreateIndex
CREATE INDEX "StockLocation_type_active_idx" ON "StockLocation"("type", "active");

-- CreateIndex
CREATE INDEX "StockLevel_locationId_idx" ON "StockLevel"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_inventoryItemId_locationId_key" ON "StockLevel"("inventoryItemId", "locationId");

-- CreateIndex
CREATE INDEX "StockReceipt_receivedAt_idx" ON "StockReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "StockMovement_inventoryItemId_createdAt_idx" ON "StockMovement"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_fromLocationId_idx" ON "StockMovement"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_toLocationId_idx" ON "StockMovement"("toLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_jobId_idx" ON "StockMovement"("jobId");

-- CreateIndex
CREATE INDEX "StockMovement_jobLineItemId_idx" ON "StockMovement"("jobLineItemId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryItem_supplierId_idx" ON "InventoryItem"("supplierId");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_jobLineItemId_fkey" FOREIGN KEY ("jobLineItemId") REFERENCES "JobLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: the warehouse location, and any stock held in the old InventoryItem columns
-- carried over as warehouse opening balances (one ADJUST movement each) so the ledger
-- explains every quantity. Duplicate rows per price book item are merged first.
INSERT INTO "StockLocation" ("id", "name", "type", "active", "updatedAt")
VALUES ('warehouse', 'Warehouse', 'WAREHOUSE', true, CURRENT_TIMESTAMP);

WITH merged AS (
  SELECT "priceBookItemId", MIN("id") AS keep_id, SUM("quantityOnHand") AS qty, MAX("reorderLevel") AS reorder
  FROM "InventoryItem" GROUP BY "priceBookItemId"
)
UPDATE "InventoryItem" i SET "quantityOnHand" = m.qty, "reorderLevel" = m.reorder
FROM merged m WHERE i."id" = m.keep_id;

DELETE FROM "InventoryItem" i USING "InventoryItem" k
WHERE i."priceBookItemId" = k."priceBookItemId" AND i."id" > k."id";

INSERT INTO "StockLevel" ("id", "inventoryItemId", "locationId", "quantity", "updatedAt")
SELECT 'lvl_' || "id", "id", 'warehouse', "quantityOnHand", CURRENT_TIMESTAMP
FROM "InventoryItem" WHERE "quantityOnHand" <> 0;

INSERT INTO "StockMovement" ("id", "inventoryItemId", "type", "quantity", "fromLocationId", "toLocationId", "reason", "updatedAt")
SELECT 'mov_' || "id", "id", 'ADJUST', ABS("quantityOnHand"),
  CASE WHEN "quantityOnHand" < 0 THEN 'warehouse' END,
  CASE WHEN "quantityOnHand" > 0 THEN 'warehouse' END,
  'Opening balance (carried over)', CURRENT_TIMESTAMP
FROM "InventoryItem" WHERE "quantityOnHand" <> 0;

-- DropIndex
DROP INDEX "InventoryItem_priceBookItemId_idx";

-- AlterTable
ALTER TABLE "InventoryItem" DROP COLUMN "location",
DROP COLUMN "quantityOnHand",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supplierSku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_priceBookItemId_key" ON "InventoryItem"("priceBookItemId");
