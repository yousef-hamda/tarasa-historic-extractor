-- Add resilience-related columns:
--   SessionState.cookiesJson: survive Railway redeploys by persisting cookies in DB
--   GroupInfo.consecutiveErrors: don't flip a group inaccessible on a single transient failure

ALTER TABLE "SessionState" ADD COLUMN "cookiesJson" TEXT;

ALTER TABLE "GroupInfo" ADD COLUMN "consecutiveErrors" INTEGER NOT NULL DEFAULT 0;
