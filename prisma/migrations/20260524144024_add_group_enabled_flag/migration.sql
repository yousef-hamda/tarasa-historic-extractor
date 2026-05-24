-- AlterTable
ALTER TABLE "GroupInfo" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "GroupInfo_isEnabled_idx" ON "GroupInfo"("isEnabled");
