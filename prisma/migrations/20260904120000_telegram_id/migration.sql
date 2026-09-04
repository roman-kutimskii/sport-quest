-- AlterTable
ALTER TABLE "User" ADD COLUMN "telegramId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
