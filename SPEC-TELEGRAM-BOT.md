# Telegram Bot — Specification

Companion to [SPEC.md](SPEC.md). Adds a Telegram bot that lives in the participants' group chat,
turns their ordinary posts («пробежал 5 км 🍂» + photo) into reports on tl-sport.ru using an LLM,
announces reports made on the website, and posts a weekly digest.

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
- Reacting to edited or deleted group messages.
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
[ 🍂 Да, бинго ]  [ ✏️ Исправить на сайте ]  [ 🗑 Отменить ]
```

- **Activity** (type, date, steps) is saved without confirmation.
- **Bingo** is saved without confirmation only when the author *names* the task in the text
  («лифтофобия», «7 этаж пешком», «бинго: ранняя пташка»). When the LLM infers it from the photo
  alone, the reply offers a one-tap button; nothing bingo-related is stored until it's pressed.
  Rationale: bingo is worth +3 and once-per-quest, so a wrong guess costs more than one tap.
- **Undo** deletes everything the bot created from that message. Only the author or an admin can
  press it. After undo the reply is edited to «Отменено» and buttons are removed.
- **Fix on site** is a URL button to the author's profile page.
- Medium-confidence messages (see 5.3) get a question instead of a save:
  «Это отчёт о тренировке? [ ✅ Да ] [ ❌ Нет ]». Nothing is stored until ✅. The question
  self-deletes after 24 h if unanswered.

Media handling:
- Photos and videos become proof files exactly as website uploads do (stored under `UPLOAD_DIR`,
  not shown in the gallery until the author opts in on the site).
- Videos over 20 MB cannot be downloaded through the Bot API. The report is still saved; the reply
  adds «видео больше 20 МБ — прикрепи его на сайте, если нужно».
- Albums (Telegram sends each photo as a separate message with a shared `media_group_id`) are
  buffered for 3 seconds and processed as one report.
- Forwarded messages are never treated as reports.

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

### 2.2 Who is the author **[decided: auto-create]**

The bot links the Telegram sender to a website account by numeric Telegram user id, then by
@username, and otherwise creates a participant from the Telegram profile (same as OIDC login
does). See 6.1 for the identity fix this requires.

### 2.3 Announcing website reports **[decided]**

When a report is created on the website, the bot posts one line to the group:

```
🧘 Маша записала йогу за 3 сен · 12 🎃 · стрик 3 🔥
🪜 Петя закрыл бинго «Лифтофобия» (5/9) · 20 🎃
```

- Bot-created reports are not announced (the in-thread reply already did).
- Reports created within the same 60 s by the same user are merged into one line.
- Deleting or rejecting a report is not announced (v1).

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
  4. drain the `Outbox` table every 3 s (website announcements, digest, deferred replies);
  5. scheduler tick every 60 s: album buffers, weekly digest, expiring questions.
- **Web app** never calls Telegram or the LLM. `submitReport` writes an `Outbox` row of kind
  `REPORT_CREATED`; the worker renders and sends it. This keeps the web request fast, survives
  bot downtime (rows wait), and makes announcements retryable and idempotent.
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

User content: sender display name, message text/caption, whether media is attached and of which
kind, forwarded flag, and up to **3 photos** (Telegram's ≤800 px size, ~100 KB each) as
`image_url`. Videos: only the thumbnail Telegram provides.

### 5.2 Output (strict JSON, validated with zod; one retry with the validation error appended)

```json
{
  "is_report": true,
  "confidence": 0.92,
  "date": "2026-09-04",            // null → message date
  "activity_types": ["run"],        // keys from ACTIVITY_TYPES; several when one message reports several activities
  "steps": 12000,                   // int | null
  "bingo_key": "leaves",            // enum of the author's open tasks | null
  "bingo_explicit": false,          // author named the task in text
  "bingo_confidence": 0.7,
  "summary_ru": "бег 5 км в парке" // ≤ 80 chars, used only in the bot's reply
}
```

Nothing free-form from the LLM reaches the database: `comment` on the created report is the
author's original text (truncated to 500 chars); `summary_ru` is only echoed in the reply. Enum
fields are checked against code constants; unknown values → treated as null.

### 5.3 Decision thresholds

| `is_report` & `confidence` | Action |
|---|---|
| ≥ 0.75 | save, reply with summary |
| 0.45 – 0.75 | ask «Это отчёт? ✅/❌», save on ✅ using the stored extraction |
| < 0.45 or `is_report = false` | ignore, record `SKIPPED` |

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
  kind       OutboxKind                   // REPORT_CREATED | DIGEST | TEXT
  chatId     String
  threadId   Int?
  payload    Json                         // e.g. { reportIds: [...] } or { periodKey: "2026-W36" }
  dedupeKey  String?  @unique             // "digest:2026-W36", "report:<id>"
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
`src/lib/reports/create.ts` so the bot and the form share one implementation. `submitReport`
additionally enqueues `Outbox(REPORT_CREATED)` for `source = WEB`.

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
| `TELEGRAM_GROUP_THREAD_ID` | Optional; topic id if the group is a forum. Digest and announcements go there; replies go to the thread of the original message. |
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
  photos-without-caption, relative dates, steps-only, explicit bingo, food photos. Prints
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
   `/id`. Outbox drain + `REPORT_CREATED` announcements. No LLM yet.
3. LLM ingestion in `shadow` mode; build the eval set from the shadow log; tune thresholds.
4. Switch to `live`. Announce in the group how it works and that «🗑 Отменить» exists.
5. Digest: first run the coming Sunday; `/digest` for a dry run earlier.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Proxy outage → bot blind | Offset persisted; updates wait on Telegram's side up to 24 h; announcements wait in the outbox; health line on admin page. |
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
5. Confidence bands 0.75 / 0.45 with a «Это отчёт?» question in the middle band.
6. Website announcements are merged per user within 60 s; deletions and rejections are not announced.
7. Digest covers Mon 00:00 → Sun 20:00 and is fully deterministic; LLM flavour text is opt-in.
8. Author's original message text becomes the report comment.
9. Commands limited to `/me`, `/top`, `/digest` (admin), `/help`.
10. Messages from chats other than the configured group are ignored.
