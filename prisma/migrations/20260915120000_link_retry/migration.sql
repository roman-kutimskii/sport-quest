-- «Повторить» on a failed bot row re-queues it; this marks the row so the pipeline runs quietly.
ALTER TABLE "TelegramLink" ADD COLUMN "retryRequestedAt" TIMESTAMP(3);
