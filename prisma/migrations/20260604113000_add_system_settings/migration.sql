-- Generic key/value store for operator-facing settings (threshold slider,
-- system-speed preset, messaging on/off, etc.) that need to survive Railway
-- redeploys. The container filesystem is ephemeral, so previously file-backed
-- settings like messaging-state.json were lost on every push.

CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
