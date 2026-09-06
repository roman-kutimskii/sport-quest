import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveQuest, getUserBreakdown, questDates } from "@/lib/quest";
import { LogForm } from "./log-form";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const user = await requireUser();
  const quest = await getActiveQuest();
  const { start, end, today } = questDates(quest);
  const data = await getUserBreakdown(quest, user.id);
  const doneBingo = data?.score.bingoCompleted.map((b) => b.key) ?? [];
  const pendingBingo = data?.reports.filter((r) => r.kind === "BINGO" && r.status === "PENDING").map((r) => r.bingoKey!) ?? [];
  const bingoDates = data?.reports.filter((r) => r.kind === "BINGO" && r.status !== "REJECTED").map((r) => r.date.toISOString().slice(0, 10)) ?? [];
  const activeDays = data?.score.activeDays ?? [];
  // Partners selectable for «Спорт-коллаб»: every active participant except the author.
  const participants = await prisma.user.findMany({
    where: { isActive: true, id: { not: user.id } }, select: { id: true, name: true, avatarEmoji: true }, orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Записать отчёт 🎃</h1>
      {!quest.autoApprove && (
        <p className="text-sm text-fgm">Отчёт попадёт на проверку организатору и засчитается после одобрения.</p>
      )}
      <LogForm
        min={start}
        max={today < end ? today : end}
        today={today}
        doneBingo={[...doneBingo, ...pendingBingo]}
        bingoDates={bingoDates}
        activeDays={activeDays}
        participants={participants}
      />
    </div>
  );
}
