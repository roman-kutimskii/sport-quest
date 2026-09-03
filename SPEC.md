# Sport Quest Tracker — Specification

Online tracker for the autumn sport quest «Операция „Анти-плед“» (3 Sep – 30 Nov 2026).
Goal: replace manual pumpkin counting in the chat with a shared board where every participant logs
activities, and the system computes Pumpkins (🎃), streaks, bingo progress, and the leaderboard.

## 1. Scope

**In scope (v1)**
- Participants log daily activities and bingo tasks with proof (image / video / link).
- Automatic scoring per the quest rules (section 3).
- Leaderboard and per-participant profile.
- Step tracking for the «Фродо» nomination.
- Admin moderation: approve / reject reports, adjust points manually, manage participants.

**Out of scope (v1)**
- Integration with Strava / Apple Health / Google Fit (possible v2).
- Telegram bot ingestion of chat posts (possible v2; the data model should allow it).
- Photo-contest voting for «Амбассадор Осени» (admin picks manually in v1).

## 2. Roles

| Role | Can do |
|---|---|
| Participant | Log own activities, upload proof, view leaderboard and profiles |
| Admin (quest organizer) | Everything a participant can, plus moderation, manual point adjustments, managing participants and quest dates, awarding final nominations |
| Viewer (optional) | Read-only leaderboard via public link |

Authentication: magic link by email or Telegram login. Keep it simple; one admin flag on the user.

## 3. Scoring Rules (source of truth)

All dates are calendar days in the quest timezone (configurable, default Europe/Moscow).
Quest range: 2026-09-03 to 2026-11-30 inclusive.

### 3.1 Base activity — 1 🎃 per active day
A day is *active* if at least one approved activity report exists for that date.
Multiple activities on one day still give exactly 1 🎃.

Accepted activity types: run, gym, yoga/stretching (≥15 min), cycling, swimming, workout, home
exercise, steps (≥10 000). Type is informational; any approved activity marks the day active.

### 3.2 Streak bonuses 🔥
A streak is a run of consecutive active days. Bonuses are awarded when a streak *reaches* a length:

| Streak length reached | Bonus |
|---|---|
| 3 days | +2 🎃 |
| 5 days | +5 🎃 |
| 7 days | +10 🎃 and title «Неуязвимый» for 7 days |

Interpretation decisions (must be confirmed with the organizer, defaults below):
- Bonuses are **cumulative** within one streak: a 7-day streak yields 2 + 5 + 10 = 17 bonus 🎃.
- After 7 days the counter **resets** and the next 7 consecutive days award the bonuses again
  (day 10 gives +2, day 12 gives +5, day 14 gives +10, etc.).
- One missed day breaks the streak; the next active day starts a new streak at 1.
- The «Неуязвимый» title is displayed on the profile and leaderboard for 7 days from the award date.

### 3.3 Autumn Bingo — +3 🎃 per task
Nine tasks, each completable **once** per quest, **at most one task per calendar day** per participant.
Maximum +27 🎃.

| Key | Task | Confirmation |
|---|---|---|
| `armor` | 🧣 «В полной броне» — outdoor workout/brisk walk in warm gear (hat, buff, gloves) | photo |
| `leaves` | 🍂 «Листопадный фитнес» — workout photo among yellow leaves | photo |
| `night` | 💡 «Ночной дозор» — evening/night workout in the dark | photo/track |
| `stairs` | 🪜 «Лифтофобия» — walk up to 7th+ floor | photo/track |
| `zen` | 🧘‍♂️ «Уютный дзен» — yoga/stretching in warm socks or sweater | photo |
| `tea` | ☕️ «Заслуженный чай» — thermos with hot drink after outdoor activity | photo |
| `collab` | 👥 «Спорт-коллаб» — joint workout/walk with someone from the chat | photo |
| `weight` | 🏋️ «Хардкор-утяжелитель» — workout with household weight | photo |
| `early` | 🌅 «Ранняя пташка» — workout started before 07:30 | photo/track |

Validation: reject a bingo report if the task is already approved for this participant, or if another
bingo task is already approved for the same date.

A bingo task does **not** by itself mark a day active. A participant normally submits both an
activity report and a bingo report for the day; the UI should offer "also counts as today's
activity" checkbox to create both at once.

### 3.4 Steps
Participants may attach a step count to any day (integer). Total steps across the quest feed the
«Фродо» nomination. Steps ≥10 000 on a day count as a valid activity for that day.

### 3.5 Manual adjustments
Admin can add or subtract 🎃 for a participant with a mandatory comment. Adjustments appear in the
participant's history.

### 3.6 Total score
```
total = active_days
      + sum(streak_bonuses)
      + 3 * approved_bingo_tasks
      + sum(manual_adjustments)
```
Scores are recomputed from the event log on every change (no stored running totals as source of
truth); cache the result per participant.

## 4. Final Nominations (30 Nov)

| Nomination | Rule | Computed |
|---|---|---|
| 👑 «Повелитель Тыкв» | Highest total score | Automatic |
| 🌋 «Фродо Осеннего Замеса» | Highest total steps | Automatic |
| 🎯 «Мастер Бинго» | First to have all 9 bingo tasks approved (by date of the 9th task, ties by submission time) | Automatic |
| 📸 «Амбассадор Осени» | Best photos/videos | Admin picks manually |

Admin can override any automatic winner. Results page unlocks after quest end or when admin publishes.

## 5. Data Model

```
User
  id, name, avatar_url, telegram_handle?, email?, is_admin, created_at

Quest
  id, title, start_date, end_date, timezone, is_active

Report                       -- every submitted claim, immutable except status
  id, user_id, quest_id
  kind: 'activity' | 'bingo' | 'steps'
  date                       -- the day being claimed
  activity_type?             -- for kind = activity
  bingo_key?                 -- for kind = bingo
  steps?                     -- for kind = steps (or attached to activity)
  duration_min?, comment?
  proof: [ { type: 'image'|'video'|'link', url } ]
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by?, reviewed_at?, reject_reason?
  created_at

Adjustment
  id, user_id, quest_id, delta_pumpkins, comment, created_by, created_at

Award                        -- derived, rebuilt by the scoring job
  id, user_id, quest_id
  type: 'streak_3' | 'streak_5' | 'streak_7' | 'invulnerable_title'
  date_awarded, pumpkins, valid_until?

NominationResult
  quest_id, nomination_key, user_id, is_manual_override, published_at
```

Constraints:
- Unique `(user_id, date, bingo_key)` among approved bingo reports.
- At most one approved bingo report per `(user_id, date)`.
- `date` must fall within the quest range.

## 6. Scoring Engine

Pure function `computeScore(reports[], adjustments[], quest) -> ScoreBreakdown`:

1. Build `activeDays: Set<date>` from approved reports where `kind = activity` or `steps ≥ 10000`.
2. Walk days from `start_date` to `min(today, end_date)`; maintain current streak length.
   On reaching 3 / 5 / 7 emit awards; on 7 reset streak counter to 0.
3. Collect approved bingo reports → 3 🎃 each.
4. Sum adjustments.
5. Return `{ activeDays, streakBonus, bingoPoints, adjustments, total, currentStreak, awards[] }`.

Must be deterministic and covered by unit tests, including:
- 7-day streak → 17 bonus, title valid 7 days.
- 8-day streak → 17 + 0; 10-day streak → 19.
- Gap of one day resets streak.
- Two bingo tasks on one day → second rejected.
- Retroactive approval of an earlier day recomputes streaks correctly.

## 7. Pages

### 7.1 Leaderboard (home)
- Table: rank, avatar + name, total 🎃, active days, current streak 🔥, bingo progress (n/9),
  total steps, badges («Неуязвимый» if active).
- Sort by total (default), steps, bingo, streak.
- Quest countdown («N days left») and quest dates.
- Highlight the current user's row.

### 7.2 Participant profile
- Score breakdown (base / streak / bingo / adjustments).
- Calendar heatmap Sep–Nov: active days, streak bonuses, bingo days, pending/rejected marks.
- Bingo card: 3×3 grid, completed cells with date and proof thumbnail.
- Step chart per week.
- Full report history with proof gallery.

### 7.3 Log activity (participant)
- Form: date (default today, no future dates), type, duration, steps, comment, proof upload
  (image/video ≤ 50 MB, or URL).
- Optional bingo task selector; validation errors shown inline (already done / another task today).
- Submissions go to `pending` unless quest setting `auto_approve = true`.

### 7.4 Admin
- Moderation queue: pending reports with proof preview, approve / reject with reason, bulk approve.
- Participants: invite link, deactivate, toggle admin.
- Adjustments: add delta with comment.
- Quest settings: dates, timezone, auto-approve, publish results.
- Nominations: view computed winners, override, publish.

### 7.5 Results (after publication)
- Four nomination cards with winners, top-3 for score and steps, full bingo masters list.

## 8. Notifications (v1 minimal)
- Email/Telegram message on report approval or rejection.
- Daily reminder at 20:00 to participants with no report today (opt-in).
- Streak milestone message («7 дней! Ты — Неуязвимый 🔥»).

## 9. Non-functional
- Mobile-first UI; most reports will be submitted from a phone.
- Proof storage: object storage (S3-compatible) with signed URLs; thumbnails generated on upload.
- Expected load: ≤ 50 participants, ≤ 200 reports/day. A single small server and Postgres suffice.
- Russian UI text; the code and keys in English.
- Export: CSV of all reports and the final leaderboard.

## 10. Suggested Stack
- Next.js (App Router) + TypeScript, Tailwind.
- Postgres + Prisma (or Drizzle).
- Auth: NextAuth with email magic link and Telegram provider.
- Storage: S3 / Cloudflare R2.
- Hosting: Vercel or a single VPS with Docker Compose.

## 11. Open Questions for the Organizer

MVP defaults (implemented, 2026-09-03): 1 — cumulative, resets after 7; 2 — no; 3 — yes; 4 — auto-approve on,
admin can switch to moderation; 5 — any date within the quest, up to today; 6 — single quest timezone (Europe/Moscow).
Auth in MVP is per-participant invite links (no passwords, no email). Notifications and CSV export are not built yet.

1. Streak bonuses: cumulative (2+5+10) or only the highest reached? Does the counter reset after 7?
2. Does a bingo task alone count as the day's activity?
3. Do steps ≥10 000 plus a workout on the same day still give only 1 🎃? (Assumed yes.)
4. Should reports be auto-approved with post-hoc rejection, or moderated first?
5. Can a participant backfill a missed day, and how long after the date?
6. Timezone for «before 07:30» and day boundaries — participants in different timezones?

## 12. Milestones
1. **M1 — Core (week 1):** auth, data model, log activity, scoring engine with tests, leaderboard.
2. **M2 — Bingo & profile (week 2):** bingo card, calendar heatmap, proof gallery, admin moderation.
3. **M3 — Polish (week 3):** notifications, steps chart, results page, CSV export, mobile QA.
