-- Invite links removed; sign-in is Telegram only.
DROP INDEX "User_inviteToken_key";
ALTER TABLE "User" DROP COLUMN "inviteToken";
