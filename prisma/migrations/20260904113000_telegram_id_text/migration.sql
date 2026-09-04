-- OIDC "sub" values exceed int64; store as text.
ALTER TABLE "User" ALTER COLUMN "telegramId" TYPE TEXT USING "telegramId"::text;
