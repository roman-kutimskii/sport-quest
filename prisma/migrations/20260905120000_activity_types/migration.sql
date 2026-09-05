-- One report can now list several activities (e.g. run + yoga on the same day).
ALTER TABLE "Report" ADD COLUMN "activityTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Report" SET "activityTypes" = ARRAY["activityType"] WHERE "activityType" IS NOT NULL;
ALTER TABLE "Report" DROP COLUMN "activityType";
