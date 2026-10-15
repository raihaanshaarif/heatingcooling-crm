-- Online (Stripe) payments removed: any such payments become card payments.
UPDATE "Payment" SET "method" = 'CARD' WHERE "method" = 'STRIPE';

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CARD', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER');
ALTER TABLE "Payment" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "public"."PaymentMethod_old";
COMMIT;

-- DropIndex
DROP INDEX "Payment_stripePaymentIntentId_key";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "stripePaymentLinkUrl";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "stripePaymentIntentId";

