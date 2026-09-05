/**
 * LLM extraction eval (SPEC-TELEGRAM-BOT.md §9): runs every case of scripts/bot-eval-set.ts through
 * `extractReport` (text only, no images) and prints per-case results, precision/recall for is_report
 * by confidence band, and field accuracy among expected reports. Run: `npm run bot:eval`.
 */
import "dotenv/config";
import { THRESHOLDS, botConfig } from "@/lib/bot/config";
import { decide, extractReport, type Extraction } from "@/lib/bot/extraction";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { EVAL_SET, MESSAGE_DATE, MESSAGE_TIME, OPEN_BINGO, type EvalCase } from "./bot-eval-set";

const QUEST_START = "2026-09-03";
const QUEST_END = "2026-11-30";
const CONCURRENCY = 3;

type Result = { c: EvalCase; e?: Extraction; error?: string; diffs: string[] };

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
    if (x.date !== undefined && (e.date ?? MESSAGE_DATE) !== x.date) out.push(`date ${e.date ?? "null→" + MESSAGE_DATE} ≠ ${x.date}`);
    if (x.bingo_key !== undefined && e.bingo_key !== x.bingo_key) out.push(`bingo ${e.bingo_key} ≠ ${x.bingo_key}`);
    if (x.bingo_explicit !== undefined && e.bingo_explicit !== x.bingo_explicit) out.push(`bingo_explicit ${e.bingo_explicit} ≠ ${x.bingo_explicit}`);
  }
  return out;
}

async function runCase(llm: OpenAiCompatLlm, limiter: RateLimiter, c: EvalCase): Promise<Result> {
  await limiter.acquire();
  try {
    const { extraction } = await extractReport(
      llm,
      {
        todayDate: MESSAGE_DATE, messageDate: MESSAGE_DATE, messageTime: MESSAGE_TIME, questStart: QUEST_START, questEnd: QUEST_END,
        openBingoKeys: OPEN_BINGO, senderName: "Маша", text: c.text || null, mediaKinds: c.mediaKinds ?? [], imageCount: 0, forwarded: false,
      },
      [],
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
  const llm = new OpenAiCompatLlm({ ...cfg.llm });
  const limiter = new RateLimiter(20);
  console.log(`model ${cfg.llm.model}, ${EVAL_SET.length} cases, message date ${MESSAGE_DATE} ${MESSAGE_TIME}\n`);

  const results = await mapLimit(EVAL_SET, CONCURRENCY, (c) => runCase(llm, limiter, c));

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  for (const r of results) {
    const mark = r.diffs.length ? "✗" : "✓";
    const text = pad(r.c.text || `(${(r.c.mediaKinds ?? []).join(",") || "empty"})`, 44);
    const got = r.e
      ? `${r.e.is_report ? "R" : "-"} ${r.e.confidence.toFixed(2)} ${r.e.activity_types.join("+") || "-"} ${r.e.date ?? "-"} ${r.e.steps ?? "-"} ${r.e.bingo_key ?? "-"}${r.e.bingo_explicit ? "!" : ""}`
      : `ERROR ${r.error}`;
    console.log(`${mark} ${text} ${pad(got, 40)} ${r.diffs.join("; ")}`);
  }

  const passed = results.filter((r) => !r.diffs.length).length;
  console.log(`\n${passed}/${results.length} cases pass`);
  console.log(`is_report, save band (≥ ${THRESHOLDS.save}):     ${prf(results, (e) => e.is_report && e.confidence >= THRESHOLDS.save)}`);
  console.log(`is_report, save+ask band (≥ ${THRESHOLDS.ask}): ${prf(results, (e) => e.is_report && e.confidence >= THRESHOLDS.ask)}`);
  console.log(accuracy(results, "activity_types", (r) => (r.c.expect.activity_types === undefined ? null : [r.c.expect.activity_types.join("+"), r.e!.activity_types.join("+")])));
  console.log(accuracy(results, "date", (r) => (r.c.expect.date === undefined ? null : [r.c.expect.date, r.e!.date ?? MESSAGE_DATE])));
  console.log(accuracy(results, "steps", (r) => (r.c.expect.steps === undefined ? null : [r.c.expect.steps, r.e!.steps])));
  console.log(accuracy(results, "bingo_key", (r) => (r.c.expect.bingo_key === undefined ? null : [r.c.expect.bingo_key, r.e!.bingo_key])));
  console.log(accuracy(results, "bingo_explicit", (r) => (r.c.expect.bingo_explicit === undefined ? null : [r.c.expect.bingo_explicit, r.e!.bingo_explicit])));
  const errors = results.filter((r) => r.error).length;
  if (errors) console.log(`${errors} case(s) errored`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
