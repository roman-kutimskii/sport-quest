-- Telegram bot: numeric Telegram user id on users, report provenance, bot tables.
CREATE TYPE "ReportSource" AS ENUM ('WEB', 'TELEGRAM');
CREATE TYPE "TelegramLinkStatus" AS ENUM ('RECEIVED', 'SKIPPED', 'ASKED', 'SAVED', 'UNDONE', 'FAILED');
CREATE TYPE "OutboxKind" AS ENUM ('REPORT_CREATED', 'DIGEST', 'TEXT');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "User" ADD COLUMN "telegramUserId" TEXT;
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "threadId" INTEGER,
    "mediaGroupId" TEXT,
    "fromUserId" TEXT NOT NULL,
    "fromName" TEXT,
    "userId" TEXT,
    "messageDate" TIMESTAMP(3) NOT NULL,
    "text" TEXT,
    "mediaKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "update" JSONB,
    "status" "TelegramLinkStatus" NOT NULL DEFAULT 'RECEIVED',
    "extraction" JSONB,
    "llmRaw" TEXT,
    "confidence" DOUBLE PRECISION,
    "replyMessageId" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramLink_chatId_messageId_key" ON "TelegramLink"("chatId", "messageId");
CREATE INDEX "TelegramLink_status_createdAt_idx" ON "TelegramLink"("status", "createdAt");
CREATE INDEX "TelegramLink_mediaGroupId_idx" ON "TelegramLink"("mediaGroupId");

ALTER TABLE "Report" ADD COLUMN "source" "ReportSource" NOT NULL DEFAULT 'WEB';
ALTER TABLE "Report" ADD COLUMN "linkId" TEXT;
CREATE INDEX "Report_linkId_idx" ON "Report"("linkId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TelegramLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "chatId" TEXT,
    "threadId" INTEGER,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Outbox_dedupeKey_key" ON "Outbox"("dedupeKey");
CREATE INDEX "Outbox_status_createdAt_idx" ON "Outbox"("status", "createdAt");

CREATE TABLE "BotState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    CONSTRAINT "BotState_pkey" PRIMARY KEY ("key")
);
