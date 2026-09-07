/**
 * LLM extraction eval (SPEC-TELEGRAM-BOT.md §9): runs every case of scripts/bot-eval-set.ts through
 * `extractReport` (with image fixtures where a case names them) and prints per-case results, precision/recall for is_report
 * by confidence band, and field accuracy among expected reports. Run: `npm run bot:eval`.
 * Optional arguments filter the set to cases whose text or fixture names contain any of them:
 * `npm run bot:eval -- steps-7264 "Сегодня был зал"`.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THRESHOLDS, botConfig } from "@/lib/bot/config";
import { decide, extractReport, type Extraction } from "@/lib/bot/extraction";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { EVAL_SET, MESSAGE_DATE, MESSAGE_TIME, OPEN_BINGO, type EvalCase } from "./bot-eval-set";

const QUEST_START = "2026-09-03";
const QUEST_END = "2026-11-30";
const CONCURRENCY = 3;
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

type Result = { c: EvalCase; e?: Extraction; error?: string; diffs: string[]; skipped?: string };

/** Reads a case's image fixtures; returns null when any of them is missing (the case is then skipped). */
function loadImages(c: EvalCase): { mime: string; data: Buffer }[] | null {
  const out: { mime: string; data: Buffer }[] = [];
  for (const name of c.images ?? []) {
    try {
      out.push({ mime: MIME[extname(name).toLowerCase()] ?? "image/png", data: readFileSync(join(FIXTURES, name)) });
    } catch {
      return null;
    }
  }
  return out;
}

function diffs(c: EvalCase, e: Extraction): string[] {
  const out: string[] = [];
  const x = c.expect;
  const predictedReport = e.is_report && e.confidence >= THRESHOLDS.ask;
  if (predictedReport !== x.is_report) out.push(`is_report ${e.is_report}@${e.confidence.toFixed(2)} ≠ ${x.is_report}`);
  if (x.is_report && x.band) {
    const band = decide(e, { hasMedia: (c.mediaKinds?.length ?? 0) > 0 }).action;
    if (band !== x.band) out.push(`band ${band} ≠ ${x.band}`);
  }
  if (x.is_report) {
    if (x.activity_types !== undefined && e.activity_types.join("+") !== x.activity_types.join("+")) out.push(`activity ${e.activity_types.join("+") || "-"} ≠ ${x.activity_types.join("+") || "-"}`);
    if (x.steps !== undefined && e.steps !== x.steps) out.push(`steps ${e.steps} ≠ ${x.steps}`);
    const msgDate = c.messageDate ?? MESSAGE_DATE;
    if (x.date !== undefined && (e.date ?? msgDate) !== x.date) out.push(`date ${e.date ?? "null→" + msgDate} ≠ ${x.date}`);
    if (x.bingo_key !== undefined && e.bingo_key !== x.bingo_key) out.push(`bingo ${e.bingo_key} ≠ ${x.bingo_key}`);
    if (x.bingo_explicit !== undefined && e.bingo_explicit !== x.bingo_explicit) out.push(`bingo_explicit ${e.bingo_explicit} ≠ ${x.bingo_explicit}`);
    if (x.collab_with !== undefined && [...e.collab_with].sort().join("+") !== [...x.collab_with].sort().join("+")) out.push(`collab_with ${e.collab_with.join("+") || "-"} ≠ ${x.collab_with.join("+") || "-"}`);
  }
  return out;
}

async function runCase(llm: OpenAiCompatLlm, limiter: RateLimiter, c: EvalCase): Promise<Result> {
  const images = loadImages(c);
  if (!images) return { c, diffs: [], skipped: `missing fixture(s): ${(c.images ?? []).join(", ")}` };
  await limiter.acquire();
  try {
    const { extraction } = await extractReport(
      llm,
      {
        todayDate: c.messageDate ?? MESSAGE_DATE, messageDate: c.messageDate ?? MESSAGE_DATE, messageTime: MESSAGE_TIME, questStart: QUEST_START, questEnd: QUEST_END,
        openBingoKeys: OPEN_BINGO, senderName: "Рома", text: c.text || null, mediaKinds: c.mediaKinds ?? [], imageCount: images.length, forwarded: false,
        mentions: c.mentions ?? [],
      },
      images,
    );
    return { c, e: extraction, diffs: diffs(c, extraction) };
  } catch (e) {
    return { c, error: e instanceof Error ? e.message : String(e), diffs: ["error"] };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function prf(results: Result[], predicate: (e: Extraction) => boolean): string {
  let tp = 0, fp = 0, fn = 0;
  for (const r of results) {
    if (!r.e) continue;
    const pred = predicate(r.e);
    if (pred && r.c.expect.is_report) tp++;
    else if (pred) fp++;
    else if (r.c.expect.is_report) fn++;
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rc = tp + fn ? tp / (tp + fn) : 0;
  return `precision ${(p * 100).toFixed(0)}% recall ${(rc * 100).toFixed(0)}% (tp ${tp}, fp ${fp}, fn ${fn})`;
}

function accuracy(results: Result[], field: string, get: (r: Result) => [expected: unknown, actual: unknown] | null): string {
  let ok = 0, n = 0;
  for (const r of results) {
    if (!r.e || !r.c.expect.is_report) continue;
    const pair = get(r);
    if (!pair) continue;
    n++;
    if (pair[0] === pair[1]) ok++;
  }
  return n ? `${field}: ${ok}/${n} (${((ok / n) * 100).toFixed(0)}%)` : `${field}: n/a`;
}

async function main() {
  const cfg = botConfig();
  if (!cfg.llm.baseUrl || !cfg.llm.apiKey) {
    console.error("LLM_BASE_URL / LLM_API_KEY are not set");
    process.exit(1);
  }
  // Empty arguments are dropped: an empty filter would match every case.
  const filters = process.argv.slice(2).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const cases = filters.length
    ? EVAL_SET.filter((c) => filters.some((f) => c.text.toLowerCase().includes(f) || (c.images ?? []).some((i) => i.toLowerCase().includes(f))))
    : EVAL_SET;
  if (!cases.length) {
    console.error(`no case matches ${filters.join(", ")}`);
    process.exit(1);
  }
  const llm = new OpenAiCompatLlm({ ...cfg.llm });
  const limiter = new RateLimiter(20);
  console.log(`model ${cfg.llm.model}, ${cases.length} cases, message date ${MESSAGE_DATE} ${MESSAGE_TIME}\n`);

  const results: Result[] = await mapLimit(cases, CONCURRENCY, (c) => runCase(llm, limiter, c));

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  for (const r of results) {
    if (r.skipped) {
      console.log(`− ${pad(r.c.text || "(photo)", 44)} skipped — ${r.skipped}`);
      continue;
    }
    const mark = r.diffs.length ? "✗" : "✓";
    const text = pad(r.c.text || `(${(r.c.mediaKinds ?? []).join(",") || "empty"})`, 44);
    const got = r.e
      ? `${r.e.is_report ? "R" : "-"} ${r.e.confidence.toFixed(2)} ${r.e.activity_types.join("+") || "-"} ${r.e.date ?? "-"} ${r.e.steps ?? "-"} ${r.e.bingo_key ?? "-"}${r.e.bingo_explicit ? "!" : ""}${r.e.collab_with.length ? ` [${r.e.collab_with.join(",")}]` : ""}`
      : `ERROR ${r.error}`;
    console.log(`${mark} ${text} ${pad(got, 40)} ${r.diffs.join("; ")}`);
  }

  const ran = results.filter((r) => !r.skipped);
  const skipped = results.length - ran.length;
  const passed = ran.filter((r) => !r.diffs.length).length;
  console.log(`\n${passed}/${ran.length} cases pass${skipped ? ` (${skipped} skipped for missing fixtures — see scripts/fixtures/README.md)` : ""}`);
  console.log(`is_report, save band (≥ ${THRESHOLDS.save}):     ${prf(results, (e) => e.is_report && e.confidence >= THRESHOLDS.save)}`);
  console.log(`is_report, save+ask band (≥ ${THRESHOLDS.ask}): ${prf(results, (e) => e.is_report && e.confidence >= THRESHOLDS.ask)}`);
  console.log(accuracy(results, "activity_types", (r) => (r.c.expect.activity_types === undefined ? null : [r.c.expect.activity_types.join("+"), r.e!.activity_types.join("+")])));
  console.log(accuracy(results, "date", (r) => (r.c.expect.date === undefined ? null : [r.c.expect.date, r.e!.date ?? r.c.messageDate ?? MESSAGE_DATE])));
  console.log(accuracy(results, "steps", (r) => (r.c.expect.steps === undefined ? null : [r.c.expect.steps, r.e!.steps])));
  console.log(accuracy(results, "bingo_key", (r) => (r.c.expect.bingo_key === undefined ? null : [r.c.expect.bingo_key, r.e!.bingo_key])));
  console.log(accuracy(results, "bingo_explicit", (r) => (r.c.expect.bingo_explicit === undefined ? null : [r.c.expect.bingo_explicit, r.e!.bingo_explicit])));
  console.log(accuracy(results, "collab_with", (r) => (r.c.expect.collab_with === undefined ? null : [[...r.c.expect.collab_with].sort().join("+"), [...r.e!.collab_with].sort().join("+")])));
  const errors = results.filter((r) => r.error).length;
  if (errors) console.log(`${errors} case(s) errored`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
