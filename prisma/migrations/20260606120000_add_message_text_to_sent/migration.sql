-- Snapshot the outreach text on the MessageSent row. The MessageGenerated row
-- is deleted once the message is dispatched, so the Sent History UI previously
-- had no way to show what was actually sent. Nullable so existing rows are
-- unaffected (they render as "—").

ALTER TABLE "MessageSent" ADD COLUMN "messageText" TEXT;
