# Telegram Bot — Specification

Companion to [SPEC.md](SPEC.md). Adds a Telegram bot that lives in the participants' group chat,
turns their ordinary posts («пробежал 5 км 🍂» + photo) into reports on tl-sport.ru using an LLM,
and posts a weekly digest. It keeps quiet while doing it: an ordinary save is acknowledged with a
reaction on the author's own message, not with a reply (see 2.1).

Decisions taken with the organizer on 2026-09-04 are marked **[decided]**. Defaults I chose without
asking are collected in section 12.

## 1. Goals and non-goals

**Goals**
1. Participants keep posting in the group exactly as today; the bot files the report for them.
2. Every report is visible in one place (the website), so the leaderboard stays the source of truth.
3. The group sees activity from the website too («Маша записала йогу за вчера»).
4. Once a week the bot posts a digest so the chat has a rhythm without anyone doing manual counting.

**Non-goals (v1)**
- Private-chat conversation with the bot (Q&A, editing reports by chatting). Editing happens on the site.
- Moderation from Telegram (approve/reject buttons for admins).
- Notifying authors about rejections (bots can only DM users who started them; most won't have).
- Reacting to deleted group messages, or to most edits. The bot subscribes to `edited_message`
  (`allowed_updates`) for one narrow case only: a message that had NO text when it was processed and
  gets a caption by editing is filed again from scratch (§2.1a). Any other edit — a partner or a
  bingo added to a post that already had text, a typo fix — is ignored: send a new message or fix it
  on the site.
- Strava/Apple Health import.

## 2. User-visible behaviour

### 2.1 Filing a report from a group post **[decided: LLM classifies every message]**

The bot reads every message in the configured group (privacy mode off). For each message (or album)
it asks the LLM whether this is an activity report and, if so, extracts the fields. Non-reports are
ignored silently. A report is **saved immediately** and the bot replies in-thread with a summary and
buttons **[decided]**:

```
🏃 Записал: бег, 4 сен · +1 🎃 · стрик 4 🔥
🍂 Похоже на бинго «Листопадный фитнес» — засчитать?
[ 🍂 Да, бинго ]  [ ✏️ Исправить на сайте ]
```

- **Activity** (type, date, steps) is saved without confirmation.
- **Bingo** is saved without confirmation only when the author *names* the task in the text
  («лифтофобия», «7 этаж пешком», «бинго: ранняя пташка»). When the LLM infers it from the photo
  alone, the reply offers a one-tap button; nothing bingo-related is stored until it's pressed.
  Rationale: bingo is worth +3 and once-per-quest, so a wrong guess costs more than one tap.
- **Undo** deletes everything the bot created from that message. Only the author or an admin can
  press it. After undo the reply is edited to «Отменено» and buttons are removed; when the save was
  acknowledged with a reaction instead, that reaction is cleared (`Outbox(REACTION)` when the admin
  page triggers it, since the web app never calls Telegram itself).
- **Fix on site** is a URL button to the author's profile page.

**Reactions instead of replies.** The reply above is sent only when it carries something the author
must act on: a bingo offer (it needs the button), a bingo that wants a photo, or a video that was
too large. The ordinary save — activity and/or steps, nothing to decide — is acknowledged with a
reaction on the author's own message: 🔥 when the report scored, 👌 when the day was already
counted. No message, no notification, nothing to scroll past. The running score moved to `/me` and
the weekly digest, which also carries the site link.

The reaction emoji must come from Telegram's own reaction set, so 🎃 cannot be used, and a group's
admins can narrow that set further; a rejected reaction is logged and the report is saved anyway.

There is no «Это отчёт о тренировке?» question any more: `THRESHOLDS.ask` equals `THRESHOLDS.save`,
so the middle band is empty (see 5.3). The handling code stays in place for rows already in that
state and for the day the band is reopened.

Media handling:
- Photos and videos become proof files exactly as website uploads do (stored under `UPLOAD_DIR`,
  not shown in the gallery until the author opts in on the site).
- Videos over 20 MB cannot be downloaded through the Bot API. The report is still saved; the reply
  adds «видео больше 20 МБ — прикрепи его на сайте, если нужно».
- Albums (Telegram sends each photo as a separate message with a shared `media_group_id`) are
  buffered for 3 seconds and processed as one report.
- Forwarded messages are never treated as reports.

«Спорт-коллаб» is credited to one person only **[decided, rules updated 2026-09-08]**: the author of
the report. Partners are never given a report of their own — each of them closes the task with their
own post. Mentions are still parsed from Telegram `entities` (never from free text) and passed to the
LLM, but only to tell a joint workout from an ordinary mention: training together with a mentioned
quest participant («пробежали 5 км с @masha») makes the collab explicit and it is saved right away,
while a partner named without an @ or outside the quest («с Машей», «с женой») makes it an inferred
bingo the author confirms with the button.

Text-only posts («12 000 шагов», «сегодня зал») are saved as reports without proof **[decided]**.
Bingo from a text-only post is never auto-saved (rules require a photo); the reply says so.

Date resolution: default is the **message's send time in Europe/Moscow**, not processing time, so a
backlog processed after bot downtime still lands on the right day. Relative words («вчера», «в
субботу», «утром») are resolved by the LLM against the message date; explicit dates win. Future
dates and dates outside the quest are dropped with a short reply.

Duplicates: if the author already has a non-rejected ACTIVITY report on that date, no second one is
created (the day is already active). Steps from the new message are written onto the existing
same-day report if it has none; proof files are appended to it only if that report was also
bot-created. The reply says «день уже засчитан ✅» and still handles steps/bingo.

### 2.1a A caption added later

People post a photo first and write the caption a minute (or three hours) later by editing it. The
first pass then judged the photo alone: a screenshot of a fitness app became «силовая + ходьба» and
the «Лифтофобия» named only in the added caption was never seen.

So an `edited_message` whose row has no text yet, and that now has one, is filed again from scratch:
the reports created by the first pass are deleted, the bot's reply is deleted, the row goes back to
RECEIVED and the normal pipeline runs on the new text. The caption may land on any message of an
album — the primary row is the one reprocessed. Rows already cancelled
stay cancelled, and a row still queued or in flight is left alone: it will read the new text anyway.

An edit of a message that already had text changes nothing, so a typo fix never re-files a report.

### 2.2 Who is the author **[decided: auto-create]**

The bot links the Telegram sender to a website account by numeric Telegram user id, then by
@username, and otherwise creates a participant from the Telegram profile (same as OIDC login
does). See 6.1 for the identity fix this requires.

### 2.3 Announcing website reports **[removed]**

The bot used to post one line to the group for every report made on the website. That was the
loudest thing it did and reactions cannot quieten it — there is no group message to react to — so
website reports are now silent. `Outbox.REPORT_CREATED` is no longer produced; the enum value is
kept so historical rows stay readable. Website activity surfaces in the weekly digest.

### 2.4 Weekly digest **[decided: Sunday 20:00 Moscow]**

Covers Monday 00:00 → Sunday 20:00 of the current week (the digest says «по состоянию на 20:00»;
late-Sunday reports roll into next week's numbers). Content, rendered deterministically from the
database:

1. Header: week number of the quest, days left.
2. Top-5 by total 🎃 with the week's delta (`+7`).
3. Most active this week: participants with the most active days (ties listed).
4. Streak milestones reached this week (3/5/7) and who currently holds «Неуязвимый».
5. Bingo closed this week: task → names; anyone who completed 9/9.
6. Steps: week total and the top-3 steppers.
7. Participation: «N из M участников отметились на этой неделе».

Optional (env flag, off by default): a 1–2 sentence LLM «комментарий недели» generated from the
same numbers. Never numbers from the LLM — only prose.

### 2.5 Commands (cheap extras, all reply in the group thread they were sent in)

| Command | Who | Reply |
|---|---|---|
| `/me` | anyone | own total, streak, bingo n/9, steps |
| `/top` | anyone | top-10 leaderboard |
| `/digest` | admin | post the digest now (for testing, not marked as the weekly run) |
| `/help` | anyone | one paragraph on what the bot does |

Messages in any chat other than the configured group are ignored; a private message gets a single
«Я работаю только в группе квеста» reply.

## 3. Constraints discovered in the current setup

1. **Telegram is unreachable from the VPS at the ISP level.** Outbound calls already go through
   `TELEGRAM_PROXY_URL` (see `src/lib/telegram.ts`). **Webhooks will not work**: a webhook is an
   inbound TCP connection from Telegram's IPs, and the VPS's reply packets to those IPs are dropped,
   so the handshake never completes. The bot must **long-poll `getUpdates` through the proxy**.
   All Bot API calls (getUpdates, sendMessage, getFile, file download) use the proxy dispatcher.
2. **The stored `telegramId` is the OIDC `sub`, not the Telegram user id.** The Telegram Login
   OIDC docs show `sub` («unique identifier», 19 digits in the example) as a separate value from the
   numeric `id` claim in the `profile` scope. The Bot API reports `message.from.id`, the numeric
   one. The callback currently discards `id`. Section 6.1 fixes this; step 0 of the rollout
   verifies the assumption against a real login.
3. **Single web replica, no job runner.** Next.js has no scheduler. The spec adds a worker process
   rather than hiding a poller inside the web server (see 4).
4. **LLM access** is via CLIProxyAPI, OpenAI-compatible, reachable from the VPS **[decided]**.
   Endpoint `POST {LLM_BASE_URL}/v1/chat/completions`, `Authorization: Bearer {LLM_API_KEY}`,
   model `gemini-3.8-flash-high`, images as `image_url` data URIs **[decided: vision on]**.
   CLIProxyAPI also exposes Gemini-native `/v1beta/models/{model}:generateContent`; keep the client
   behind one small interface so switching is a one-file change.

## 4. Architecture

```
Telegram ──(proxy)── bot worker ──── Postgres ──── Next.js web app
                        │  ▲                          │
                        │  └── Outbox rows ◄──────────┘  (website report created)
                        └──► CLIProxyAPI (LLM)
```

- **`bot` worker**: a new compose service running the existing `-tools` image with
  `command: npx tsx scripts/bot.ts` (the tools image already has the full source and
  `node_modules`; no new Docker build stage). One replica. Responsibilities:
  1. **receive loop**: long-poll `getUpdates` (timeout 30 s, offset persisted in `BotState`).
     Telegram returns as soon as an update exists, so latency is one proxy round trip, not the
     timeout. The loop only stores updates and re-polls; it never waits on the LLM;
  2. **callback queries** (buttons) are handled inline by the receive loop: `answerCallbackQuery`
     first so the spinner clears, then the database change and the reply edit. Nothing slow may
     run here;
  3. **message queue**: stored messages are processed by a separate loop with up to 3 LLM calls in
     flight, ordered per author so two posts from one person can't race the duplicate rules;
  4. drain the `Outbox` table every 3 s (digest, deferred replies);
  5. scheduler tick every 60 s: album buffers, weekly digest, expiring questions.
- **Web app** never calls Telegram or the LLM. It writes nothing to `Outbox` any more (website
  reports are not announced — see 2.3); the table still carries the digest and deferred replies,
  which survive bot downtime (rows wait) and stay retryable and idempotent.
- **Shared code** lives in `src/lib/bot/` and is imported by both the worker and the web app:
  Telegram client, LLM client + prompt, extraction schema, identity linking, report creation
  service (shared with `submitReport` so validation rules stay in one place), digest renderer.
- **No framework**: a ~150-line Telegram client on `undici` (the proxy dispatcher pattern already
  exists). grammY would be acceptable but adds a dependency for little gain here.
- **Runtime validation**: add `zod` for the LLM output schema and Telegram update parsing.

Failure model: any exception while processing one update is caught, recorded on the
`TelegramLink` row (`status = FAILED`, `error`), and the loop continues. The offset is advanced
once the update is stored as a `TelegramLink` row (`RECEIVED`), so nothing is silently lost even
if the process dies mid-LLM-call: unprocessed `RECEIVED` rows are picked up again on start.
The process exits on unrecoverable errors (bad token, DB down) and Docker restarts it.

## 5. LLM extraction

### 5.1 Input

System prompt (Russian rules, English keys) containing:
- today's date and the message date in Europe/Moscow;
- the quest range;
- the activity type list (`ACTIVITY_TYPES` keys + titles) and the nine bingo tasks with their
  descriptions (`BINGO_TASKS`), generated from code so they never drift;
- the author's open bingo tasks (already-closed ones are excluded from the allowed enum);
- the exact JSON schema and the rule «if unsure whether this is a report, say so via confidence».

User content: sender display name, message text/caption, the list of mentioned users (handle,
name, whether they are a quest participant), whether media is attached and of which
kind, forwarded flag, and up to **3 photos** (Telegram's ≤800 px size, ~100 KB each) as
`image_url`. Videos: only the thumbnail Telegram provides.

### 5.2 Output (strict JSON, validated with zod; one retry with the validation error appended)

```json
{
  "is_report": true,
  "confidence": 0.92,
  "date": "2026-09-04",            // null → message date
  "activity_types": ["run"],        // keys from ACTIVITY_TYPES; several when one message reports several activities
  "steps": 12000,                   // int | null — from the text or from an attached pedometer screenshot
  "bingo_key": "leaves",            // enum of the author's open tasks | null
  "bingo_explicit": false,          // author named the task in text
  "bingo_confidence": 0.7,
  "collab_with": ["masha"],         // handles (from the mentions list given in the input) of participants who trained together with the author
  "summary_ru": "бег 5 км в парке" // ≤ 80 chars, used only in the bot's reply
}
```

`collab_with` is filtered against the mention list the bot passed in (parsed from Telegram
`entities`), so the LLM cannot invent a partner. Mentions of people who are not participants are
shown to the LLM as such and can never end up in `collab_with`.

Nothing free-form from the LLM reaches the database: `comment` on the created report is the
author's original text (truncated to 500 chars); `summary_ru` is only echoed in the reply. Enum
fields are checked against code constants; unknown values → treated as null.

### 5.3 Decision thresholds

| `is_report` & `confidence` | Action |
|---|---|
| ≥ 0.75 | save, acknowledged with a reaction (or a reply when there is something to say — see 2.1) |
| < 0.75 or `is_report = false` | ignore, record `SKIPPED` |

`THRESHOLDS.ask` is set equal to `THRESHOLDS.save`, so the «Это отчёт? ✅/❌» band is empty. The
eval set is what justifies this: the model puts every real report at ≥ 0.85 and every non-report at
≤ 0.15, so the old 0.45–0.75 band never caught anything. Lowering `ask` brings the question back.

Bingo: saved directly only if `bingo_explicit && bingo_confidence ≥ 0.75 && has media`; offered as
a button if `bingo_key` set and `bingo_confidence ≥ 0.5 && has media`; otherwise not mentioned.
The thresholds are constants in one file and are tuned against the eval set (section 9).

### 5.4 Cost and limits

Gemini Flash with 1–3 small images: well under $0.01 per message; ≤ 50 participants × a few posts a
day is negligible. Worker-side guard: max 20 LLM calls per minute; over the limit messages wait in
the queue (they're processed in order, the date comes from the message). Request timeout 40 s,
two retries with backoff for 5xx/429/network errors, then `FAILED` and silence (the admin list in
7.2 shows it; the author can use the site).

## 6. Data model changes

### 6.1 Identity

```prisma
model User {
  telegramId     String? @unique   // existing: OIDC `sub`
  telegramUserId String? @unique   // NEW: numeric Telegram user id (Bot API `from.id`)
  ...
}
```

- OIDC callback: read the `id` claim and store it in `telegramUserId` on every login (also
  matches an existing user by `telegramUserId` before falling back to @username, so a user first
  created by the bot is recognised when they later sign in).
- Bot linking order: `telegramUserId` → normalized @username (`telegramHandle`) with
  `telegramUserId` still null (backfill it) → create user
  `{ name: first_name + last_name, telegramHandle, telegramUserId }`.
- Existing users get `telegramUserId` on their next login; until then the bot matches them by
  username. Users without a username who haven't logged in since the change would be duplicated;
  the admin page gets a «Объединить с…» action for that case (moves reports, deactivates the extra).

### 6.2 Bot tables

```prisma
enum ReportSource { WEB TELEGRAM }

model Report {
  source   ReportSource  @default(WEB)   // NEW
  linkId   String?                       // NEW → TelegramLink
  ...
}

model TelegramLink {                      // one row per processed group message / album
  id              String   @id @default(cuid())
  chatId          String
  messageId       Int
  threadId        Int?
  mediaGroupId    String?
  fromUserId      String                  // numeric Telegram id
  userId          String?                 // linked participant
  messageDate     DateTime
  text            String?
  mediaKinds      String[]                // photo | video | document
  status          TelegramLinkStatus      // RECEIVED | SKIPPED | ASKED | SAVED | UNDONE | FAILED
  extraction      Json?                   // validated LLM output
  llmRaw          String?                 // raw model text, for debugging
  confidence      Float?
  replyMessageId  Int?                    // the bot's reply, for editing/undo
  error           String?
  createdAt       DateTime @default(now())
  processedAt     DateTime?
  reports         Report[]
  @@unique([chatId, messageId])
}

model Outbox {                            // everything the bot sends that isn't a direct reply
  id         String   @id @default(cuid())
  kind       OutboxKind                   // DIGEST | TEXT | REACTION (REPORT_CREATED is retired, see 2.3)
  chatId     String
  threadId   Int?
  payload    Json                         // e.g. { reportIds: [...] } or { periodKey: "2026-W36" }
  dedupeKey  String?  @unique             // "digest:2026-W36"
  status     OutboxStatus @default(PENDING) // PENDING | SENT | FAILED
  attempts   Int      @default(0)
  sentAt     DateTime?
  createdAt  DateTime @default(now())
}

model BotState {                          // key/value: getUpdates offset, last digest period
  key   String @id
  value Json
}
```

Chat and user ids are stored as strings (Telegram ids exceed 32 bits). Uploaded proof files reuse
the current naming scheme and `UPLOAD_DIR`.

## 7. Web app changes

### 7.1 Report creation service
Extract the body of `submitReport` (validation, bingo uniqueness, transaction) into
`src/lib/reports/create.ts` so the bot and the form share one implementation.

«Спорт-коллаб» needs nothing extra here: it is an ordinary bingo of the author's own report, on both
the bot and the website form.

### 7.2 Admin page additions
- «Бот»: last 100 `TelegramLink` rows with status, sender, extraction summary, error; buttons:
  delete created reports (same as undo), open message in Telegram (`t.me/c/<id>/<msg>`).
- «Объединить участников» for the duplicate case in 6.1.
- Bot health line: last successful `getUpdates`, outbox backlog, LLM error count last 24 h.

### 7.3 Profile
Reports created by the bot show a small Telegram icon and a link to the source message.

## 8. Configuration

| Variable | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Reuse the login bot from BotFather (the OIDC `client_id` is tied to a bot; one identity for login and chat). Privacy mode must be **disabled** via `/setprivacy`, or the bot added as a group admin. |
| `TELEGRAM_GROUP_CHAT_ID` | Numeric id of the group (negative). Obtained once via `/id` (a hidden command that replies with the chat id when the variable is unset). |
| `TELEGRAM_GROUP_THREAD_ID` | Optional; topic id if the group is a forum. The digest goes there; replies and reactions go to the original message. |
| `TELEGRAM_PROXY_URL` | Existing. Now also used by the worker. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | CLIProxyAPI; model `gemini-3.8-flash-high`. |
| `BOT_MODE` | `off` \| `shadow` \| `live`. Shadow = classify and record, never write reports or send messages. |
| `DIGEST_WEEKDAY`, `DIGEST_HOUR` | Default `0` (Sunday), `20`, Europe/Moscow. |
| `DIGEST_LLM_COMMENT` | `0`/`1`, default `0`. |

Compose: new `bot` service (tools image, `restart: unless-stopped`, same env as `app` plus the
above, shares the `uploads` volume). `deploy.sh` needs no change beyond the compose file.

## 9. Testing

- **Unit (vitest, pure)**: extraction schema validation and enum coercion; threshold decisions;
  date resolution edge cases (message at 00:30 Moscow, «вчера» across month boundary, future date,
  pre-quest date); duplicate rules; digest renderer against fixture data (including ties and a
  week with no reports); outbox dedupe keys; username normalization for linking.
- **Telegram client**: parsing fixtures of real update JSON (text, photo, album, video > 20 MB,
  forward, callback query, edited message, message from another chat).
- **LLM eval set** (`scripts/bot-eval.ts`, run manually): ~40 Russian messages with expected
  outputs — clear reports, chatter, encouragement («молодцы!»), plans («завтра побегу»),
  photos-without-caption, relative dates, steps-only, steps read off a pedometer screenshot (with
  negative cases: kcal / BPM / duration must not become steps), explicit bingo, food photos, mentions
  (partner in a joint activity → `collab` + `collab_with`; mention in another role → no collab;
  mention of a non-participant → no `collab_with`). Prints
  precision/recall per threshold band. Run before changing the prompt or thresholds.
- **Shadow mode in production** for 2–3 days before going live; the admin table shows what the
  bot would have done.

## 10. Rollout

0. **Identity check (before any code)**: sign in on production with `AUTH_DEBUG` logging the
   `id` claim; compare with the same account's `from.id` seen via `getUpdates`. If they differ
   from expectation, adjust 6.1 before continuing.
1. Migration: `telegramUserId`, `Report.source/linkId`, bot tables. Callback stores the `id` claim.
   Deploy early so ids populate as people log in over the following days.
2. Worker skeleton: polling through the proxy, `BotState` offset, `/help`, `/me`, `/top`,
   `/id`. Outbox drain. No LLM yet.
3. LLM ingestion in `shadow` mode; build the eval set from the shadow log; tune thresholds.
4. Switch to `live`. Announce in the group how it works.
5. Digest: first run the coming Sunday; `/digest` for a dry run earlier.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Proxy outage → bot blind | Offset persisted; updates wait on Telegram's side up to 24 h; digest rows wait in the outbox; health line on admin page. |
| Mis-filed reports annoy people | Undo button, shadow mode first, thresholds tuned on the eval set, bingo needs a tap unless explicit. |
| Prompt injection via chat text or images | LLM output is enums/ints only; free text stored is the author's message, never model output. |
| Duplicate users (no username, not logged in) | Merge action on the admin page. |
| Two bot processes polling at once (deploy overlap) | Telegram rejects concurrent `getUpdates` with 409; the worker backs off and retries, and compose replaces the old container before starting the new one for a single-replica service. |
| Large videos as proof | Documented 20 MB Bot API limit; reply points to the site. |

## 12. Defaults I chose (say so if you want them changed)

1. Reuse the login bot as the chat bot (one BotFather bot, one token) rather than creating a second bot.
2. Long polling worker as a separate compose service on the tools image, not a poller inside the Next.js process.
3. Outbox table for all non-reply sends; the web app never talks to Telegram directly.
4. Bingo inferred from a photo needs one tap; bingo named in text is saved directly.
5. One confidence threshold at 0.75; the «Это отчёт?» band is empty because the model never lands in it.
6. Ordinary saves are acknowledged with a reaction; website reports are not announced at all.
7. Digest covers Mon 00:00 → Sun 20:00 and is fully deterministic; LLM flavour text is opt-in.
8. Author's original message text becomes the report comment.
9. Commands limited to `/me`, `/top`, `/digest` (admin), `/help`.
10. Messages from chats other than the configured group are ignored.
