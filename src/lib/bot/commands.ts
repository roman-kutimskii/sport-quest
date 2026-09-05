/** Slash commands (spec §2.5): /help, /me, /top, /digest (admin), /id (setup). Cheap, run inline in the receive loop. */
import { BINGO_TASKS } from "@/lib/bingo";
import { getActiveQuest, getLeaderboard } from "@/lib/quest";
import { periodKey, nowInTz } from "./dates";
import { linkSender } from "./identity";
import { errorMessage, type Deps } from "./ingest";
import { enqueueDigest } from "./outbox";
import type { TgMessage } from "./telegram-api";
import { renderHelp, renderMe, renderPrivateOnlyGroup, renderTop } from "./text";

export type Command = { name: string; args: string };

export async function handleCommand(deps: Deps, m: TgMessage, cmd: Command): Promise<void> {
  const { api, cfg } = deps;
  const chatId = String(m.chat.id);
  const reply = (text: string) => api.sendMessage({ chatId: m.chat.id, text, threadId: m.message_thread_id ?? null, replyTo: m.message_id, disablePreview: true });

  try {
    // /id works anywhere while the group is not configured yet (that is how the id is obtained).
    if (cfg.groupChatId === null && cmd.name === "id") {
      await reply(`chat id: ${chatId}\nthread id: ${m.message_thread_id ?? "—"}`);
      return;
    }
    if (cfg.groupChatId !== null && chatId !== cfg.groupChatId) {
      if (m.chat.type === "private" && cfg.mode === "live") await reply(renderPrivateOnlyGroup());
      return;
    }
    // Shadow mode never sends anything (only /id above, which is needed for setup).
    if (cfg.mode !== "live") return;

    switch (cmd.name) {
      case "help":
      case "start":
        await reply(renderHelp(cfg.publicUrl));
        return;
      case "top": {
        const rows = await getLeaderboard(await getActiveQuest());
        await reply(renderTop(rows.slice(0, 10).map((r) => ({ rank: r.rank, name: r.user.name, avatarEmoji: r.user.avatarEmoji, total: r.score.total, streak: r.score.currentStreak }))));
        return;
      }
      case "me": {
        if (!m.from) return;
        const user = await linkSender(m.from);
        const rows = await getLeaderboard(await getActiveQuest());
        const row = rows.find((r) => r.user.id === user.id);
        if (!row) {
          await reply("Тебя нет в таблице — напиши организатору.");
          return;
        }
        await reply(renderMe({
          name: user.name, total: row.score.total, streak: row.score.currentStreak, bingo: row.score.bingoCompleted.length,
          bingoTotal: BINGO_TASKS.length, steps: row.score.totalSteps, rank: row.rank, activeDays: row.score.activeDayCount,
        }));
        return;
      }
      case "digest": {
        if (!m.from) return;
        const user = await linkSender(m.from);
        if (!user.isAdmin) return;
        const target = cfg.groupChatId ?? chatId;
        const threadId = cfg.groupChatId ? cfg.groupThreadId : (m.message_thread_id ?? null);
        await enqueueDigest(periodKey(nowInTz(cfg.timezone).date), target, threadId, { manual: true });
        await reply("Дайджест поставлен в очередь, выйдет через несколько секунд.");
        return;
      }
      default:
        return; // unknown commands are ignored
    }
  } catch (e) {
    console.error(`[bot] ${new Date().toISOString()} command /${cmd.name} failed: ${errorMessage(e)}`);
  }
}
