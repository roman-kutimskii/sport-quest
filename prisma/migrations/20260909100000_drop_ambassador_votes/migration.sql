-- «Амбассадор Осени» is picked by the organizer; the participant poll is gone.
DROP TABLE "AmbassadorVote";
ALTER TABLE "Quest" DROP COLUMN "votingOpen";

-- The public gallery is gone with it.
ALTER TABLE "Report" DROP COLUMN "galleryUrls";
