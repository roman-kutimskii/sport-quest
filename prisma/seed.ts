import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ReportKind, ReportStatus } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** UTC-midnight date for a `@db.Date` column. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const QUEST_TITLE = "Операция «Анти-плед»";

type ActivitySeed = { date: string; activityType: string; durationMin: number; steps?: number };
type BingoSeed = { date: string; bingoKey: string };

const participants: Array<{
  name: string;
  avatarEmoji: string;
  activities: ActivitySeed[];
  bingos: BingoSeed[];
}> = [
  {
    // 7-day streak: Aug 28 .. Sep 3
    name: "Аня",
    avatarEmoji: "🦊",
    activities: [
      { date: "2026-08-28", activityType: "run", durationMin: 35, steps: 12400 },
      { date: "2026-08-29", activityType: "walk", durationMin: 60, steps: 14800 },
      { date: "2026-08-30", activityType: "yoga", durationMin: 40, steps: 8200 },
      { date: "2026-08-31", activityType: "run", durationMin: 30, steps: 11300 },
      { date: "2026-09-01", activityType: "gym", durationMin: 50, steps: 9600 },
      { date: "2026-09-02", activityType: "bike", durationMin: 45, steps: 8900 },
      { date: "2026-09-03", activityType: "run", durationMin: 25, steps: 10500 },
    ],
    bingos: [
      { date: "2026-08-30", bingoKey: "zen" },
      { date: "2026-09-02", bingoKey: "stairs" },
    ],
  },
  {
    // gaps: Aug 25, 26, 29, Sep 1, 3
    name: "Дима",
    avatarEmoji: "🐻",
    activities: [
      { date: "2026-08-25", activityType: "gym", durationMin: 60, steps: 9100 },
      { date: "2026-08-26", activityType: "walk", durationMin: 40, steps: 13200 },
      { date: "2026-08-29", activityType: "run", durationMin: 30, steps: 11900 },
      { date: "2026-09-01", activityType: "swim", durationMin: 45, steps: 8000 },
      { date: "2026-09-03", activityType: "gym", durationMin: 55, steps: 10200 },
    ],
    bingos: [{ date: "2026-08-26", bingoKey: "early" }],
  },
  {
    // 3-day streak Aug 31 .. Sep 2, plus one earlier
    name: "Катя",
    avatarEmoji: "🦉",
    activities: [
      { date: "2026-08-27", activityType: "walk", durationMin: 50, steps: 15000 },
      { date: "2026-08-31", activityType: "yoga", durationMin: 30, steps: 8400 },
      { date: "2026-09-01", activityType: "run", durationMin: 35, steps: 12100 },
      { date: "2026-09-02", activityType: "walk", durationMin: 70, steps: 14100 },
    ],
    bingos: [{ date: "2026-09-01", bingoKey: "tea" }],
  },
];

async function upsertUser(name: string, avatarEmoji: string, isAdmin = false) {
  const existing = await prisma.user.findFirst({ where: { name } });
  if (existing) {
    return prisma.user.update({ where: { id: existing.id }, data: { avatarEmoji, isAdmin } });
  }
  return prisma.user.create({ data: { name, avatarEmoji, isAdmin } });
}

async function main() {
  const existingQuest = await prisma.quest.findFirst({ where: { title: QUEST_TITLE } });
  const questData = {
    title: QUEST_TITLE,
    startDate: d("2026-09-03"),
    endDate: d("2026-11-30"),
    timezone: "Europe/Moscow",
    autoApprove: true,
    isActive: true,
  };
  const quest = existingQuest
    ? await prisma.quest.update({ where: { id: existingQuest.id }, data: questData })
    : await prisma.quest.create({ data: questData });


  const withSamples = process.env.SEED_SAMPLES !== "0";
  for (const p of withSamples ? participants : []) {
    const user = await upsertUser(p.name, p.avatarEmoji);

    // Idempotent: wipe this user's seeded reports for the quest and recreate.
    await prisma.report.deleteMany({ where: { userId: user.id, questId: quest.id } });

    await prisma.report.createMany({
      data: [
        ...p.activities.map((a) => ({
          userId: user.id,
          questId: quest.id,
          kind: ReportKind.ACTIVITY,
          date: d(a.date),
          activityType: a.activityType,
          durationMin: a.durationMin,
          steps: a.steps ?? null,
          status: ReportStatus.APPROVED,
          reviewedAt: new Date(),
        })),
        ...p.bingos.map((b) => ({
          userId: user.id,
          questId: quest.id,
          kind: ReportKind.BINGO,
          date: d(b.date),
          bingoKey: b.bingoKey,
          status: ReportStatus.APPROVED,
          reviewedAt: new Date(),
        })),
      ],
    });
  }

  const reportCount = await prisma.report.count({ where: { questId: quest.id } });
  console.log(`Quest "${quest.title}" (${quest.id}) — ${reportCount} reports\n`);
  console.log("Sign in via Telegram; usernames in TELEGRAM_ADMIN_USERNAMES become admins.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
