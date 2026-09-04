-- Poll for "Амбассадор Осени": every participant picks one other participant.
ALTER TABLE "Quest" ADD COLUMN "votingOpen" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AmbassadorVote" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmbassadorVote_questId_voterId_key" ON "AmbassadorVote"("questId", "voterId");
CREATE INDEX "AmbassadorVote_questId_candidateId_idx" ON "AmbassadorVote"("questId", "candidateId");

ALTER TABLE "AmbassadorVote" ADD CONSTRAINT "AmbassadorVote_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmbassadorVote" ADD CONSTRAINT "AmbassadorVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmbassadorVote" ADD CONSTRAINT "AmbassadorVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
