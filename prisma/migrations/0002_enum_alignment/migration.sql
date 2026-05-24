-- Align types with Prisma schema enums and add missing indexes

-- Create enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageStatus') THEN
    CREATE TYPE "MessageStatus" AS ENUM ('pending', 'sent', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogType') THEN
    CREATE TYPE "LogType" AS ENUM ('scrape', 'classify', 'message', 'auth', 'error');
  END IF;
END $$;

-- Convert MessageSent.status from text -> enum with safe casting
ALTER TABLE "MessageSent"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "MessageStatus" USING ("status"::text::"MessageStatus"),
  ALTER COLUMN "status" SET DEFAULT 'pending';

-- Convert SystemLog.type from text -> enum with safe casting
ALTER TABLE "SystemLog"
  ALTER COLUMN "type" TYPE "LogType" USING ("type"::text::"LogType");

-- Add indexes aligned with schema (skip if they already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'PostRaw_groupId_idx') THEN
    CREATE INDEX "PostRaw_groupId_idx" ON "PostRaw"("groupId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'PostRaw_scrapedAt_idx') THEN
    CREATE INDEX "PostRaw_scrapedAt_idx" ON "PostRaw"("scrapedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'MessageGenerated_postId_idx') THEN
    CREATE INDEX "MessageGenerated_postId_idx" ON "MessageGenerated"("postId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'MessageGenerated_createdAt_idx') THEN
    CREATE INDEX "MessageGenerated_createdAt_idx" ON "MessageGenerated"("createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'MessageSent_status_idx') THEN
    CREATE INDEX "MessageSent_status_idx" ON "MessageSent"("status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'MessageSent_sentAt_idx') THEN
    CREATE INDEX "MessageSent_sentAt_idx" ON "MessageSent"("sentAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'SystemLog_type_idx') THEN
    CREATE INDEX "SystemLog_type_idx" ON "SystemLog"("type");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'SystemLog_createdAt_idx') THEN
    CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");
  END IF;
END $$;
