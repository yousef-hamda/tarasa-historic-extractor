-- CreateEnum
CREATE TYPE "PromptType" AS ENUM ('classifier', 'generator');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('pending', 'reviewed', 'dismissed', 'merged');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('daily', 'weekly', 'monthly');

-- AlterEnum
ALTER TYPE "LogType" ADD VALUE 'admin';

-- DropForeignKey
ALTER TABLE "MessageGenerated" DROP CONSTRAINT "MessageGenerated_postId_fkey";

-- DropForeignKey
ALTER TABLE "MessageSent" DROP CONSTRAINT "MessageSent_postId_fkey";

-- DropForeignKey
ALTER TABLE "PostClassified" DROP CONSTRAINT "PostClassified_postId_fkey";

-- AlterTable
ALTER TABLE "PostRaw" ADD COLUMN     "postUrl" TEXT;

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" SERIAL NOT NULL,
    "type" "PromptType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityRating" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "factors" TEXT NOT NULL,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateGroup" (
    "id" SERIAL NOT NULL,
    "primaryPostId" INTEGER NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "DuplicateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateMatch" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DuplicateMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageVariant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "promptTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMetrics" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "responses" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportConfig" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'weekly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportHistory" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" TEXT NOT NULL,
    "stats" TEXT NOT NULL,

    CONSTRAINT "ReportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptTemplate_type_idx" ON "PromptTemplate"("type");

-- CreateIndex
CREATE INDEX "PromptTemplate_isActive_idx" ON "PromptTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_type_isActive_key" ON "PromptTemplate"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QualityRating_postId_key" ON "QualityRating"("postId");

-- CreateIndex
CREATE INDEX "QualityRating_rating_idx" ON "QualityRating"("rating");

-- CreateIndex
CREATE INDEX "QualityRating_ratedAt_idx" ON "QualityRating"("ratedAt");

-- CreateIndex
CREATE INDEX "DuplicateGroup_status_idx" ON "DuplicateGroup"("status");

-- CreateIndex
CREATE INDEX "DuplicateGroup_detectedAt_idx" ON "DuplicateGroup"("detectedAt");

-- CreateIndex
CREATE INDEX "DuplicateMatch_postId_idx" ON "DuplicateMatch"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateMatch_groupId_postId_key" ON "DuplicateMatch"("groupId", "postId");

-- CreateIndex
CREATE INDEX "MessageVariant_isActive_idx" ON "MessageVariant"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMetrics_variantId_key" ON "VariantMetrics"("variantId");

-- CreateIndex
CREATE INDEX "ReportConfig_isActive_idx" ON "ReportConfig"("isActive");

-- CreateIndex
CREATE INDEX "ReportConfig_frequency_idx" ON "ReportConfig"("frequency");

-- CreateIndex
CREATE INDEX "ReportHistory_sentAt_idx" ON "ReportHistory"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "UserPreference_language_idx" ON "UserPreference"("language");

-- CreateIndex
CREATE INDEX "PostRaw_authorName_idx" ON "PostRaw"("authorName");

-- AddForeignKey
ALTER TABLE "PostClassified" ADD CONSTRAINT "PostClassified_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageGenerated" ADD CONSTRAINT "MessageGenerated_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSent" ADD CONSTRAINT "MessageSent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRating" ADD CONSTRAINT "QualityRating_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateMatch" ADD CONSTRAINT "DuplicateMatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DuplicateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMetrics" ADD CONSTRAINT "VariantMetrics_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "MessageVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

