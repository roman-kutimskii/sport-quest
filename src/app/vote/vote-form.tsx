"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Proof } from "@/components/proof";
import { castVote, type VoteState } from "./actions";

type Candidate = { id: string; name: string; avatarEmoji: string; mediaCount: number; preview: string[] };

export function VoteForm({ candidates, current }: { candidates: Candidate[]; current: string | null }) {
  const [choice, setChoice] = useState<string | null>(current);
  const [state, action, pending] = useActionState<VoteState, FormData>(castVote, undefined);
  const unchanged = choice === current;

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="sr-only">Кандидаты</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {candidates.map((c) => {
            const selected = choice === c.id;
            return (
              <div
                key={c.id}
                className={`rounded-xl border p-3 transition ${selected ? "border-accent bg-accent-soft" : "border-line bg-elev"}`}
              >
                <button
                  type="button" onClick={() => setChoice(c.id)} aria-pressed={selected}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="text-2xl" aria-hidden>{c.avatarEmoji}</span>
                  <span className="flex-1 font-semibold">{c.name}</span>
                  <span className="text-xs text-fgm">{c.mediaCount} 📷</span>
                  {selected && <span aria-hidden>✅</span>}
                </button>
                {c.preview.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {c.preview.map((url) => <Proof key={url} url={url} className="aspect-square w-full" />)}
                  </div>
                )}
                {c.mediaCount > 4 && (
                  <Link href="/gallery" className="mt-2 block text-right text-xs text-fgm hover:underline">все {c.mediaCount} →</Link>
                )}
              </div>
            );
          })}
        </div>
        <input type="hidden" name="candidateId" value={choice ?? ""} />
      </fieldset>

      {state?.error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{state.error}</p>}
      {state?.ok && unchanged && <p className="rounded-xl bg-ok-soft p-3 text-sm text-ok" role="status">Голос учтён 📸</p>}

      <button className="btn-primary" disabled={pending || !choice || unchanged}>
        {pending ? "Сохраняю…" : current ? "Изменить голос" : "Голосовать"}
      </button>
    </form>
  );
}
