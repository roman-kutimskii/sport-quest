ALTER TABLE "Report" ADD COLUMN "proofUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Report" SET "proofUrls" = ARRAY["proofUrl"] WHERE "proofUrl" IS NOT NULL;

ALTER TABLE "Report" DROP COLUMN "proofUrl";
