-- Add retryCount column to MessageSent
ALTER TABLE "MessageSent" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;

-- Add unique constraint on postId and authorLink (handle duplicates first)
-- First, delete duplicates keeping the most recent one
DELETE FROM "MessageSent" a USING "MessageSent" b
WHERE a.id < b.id 
AND a."postId" = b."postId" 
AND a."authorLink" = b."authorLink";

-- Add unique constraint
ALTER TABLE "MessageSent" ADD CONSTRAINT "MessageSent_postId_authorLink_key" UNIQUE ("postId", "authorLink");

-- Add indexes for PostClassified
CREATE INDEX IF NOT EXISTS "PostClassified_isHistoric_confidence_idx" ON "PostClassified"("isHistoric", "confidence");
CREATE INDEX IF NOT EXISTS "PostClassified_classifiedAt_idx" ON "PostClassified"("classifiedAt");

-- Add index for MessageSent
CREATE INDEX IF NOT EXISTS "MessageSent_postId_status_idx" ON "MessageSent"("postId", "status");
