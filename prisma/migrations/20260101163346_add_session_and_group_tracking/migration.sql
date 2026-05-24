-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('valid', 'expired', 'invalid', 'refreshing', 'blocked', 'unknown');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('public', 'private', 'unknown');

-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('apify', 'playwright', 'none');

-- CreateTable
CREATE TABLE "SessionState" (
    "id" SERIAL NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'unknown',
    "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValid" TIMESTAMP(3),
    "errorMessage" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupInfo" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupType" "GroupType" NOT NULL DEFAULT 'unknown',
    "groupName" TEXT,
    "memberCount" INTEGER,
    "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScraped" TIMESTAMP(3),
    "accessMethod" "AccessMethod" NOT NULL DEFAULT 'none',
    "isAccessible" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionState_status_idx" ON "SessionState"("status");

-- CreateIndex
CREATE INDEX "SessionState_lastChecked_idx" ON "SessionState"("lastChecked");

-- CreateIndex
CREATE UNIQUE INDEX "GroupInfo_groupId_key" ON "GroupInfo"("groupId");

-- CreateIndex
CREATE INDEX "GroupInfo_groupType_idx" ON "GroupInfo"("groupType");

-- CreateIndex
CREATE INDEX "GroupInfo_accessMethod_idx" ON "GroupInfo"("accessMethod");
