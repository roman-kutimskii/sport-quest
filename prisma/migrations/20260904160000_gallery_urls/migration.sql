-- Subset of proofUrls the author chose to show in the public gallery.
ALTER TABLE "Report" ADD COLUMN "galleryUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
