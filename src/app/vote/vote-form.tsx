"use client";

import { useActionState, useState } from "react";
import { castVote, type VoteState } from "./actions";

type Candidate = { id: string; name: string; avatarEmoji: string };

export function VoteForm({ candidates, current }: { candidates: Candidate[]; current: string | null }) {
  const [choice, setChoice] = useState<string | null>(current);
  const [state, action, pending] = useActionState<VoteState, FormData>(castVote, undefined);
  const unchanged = choice === current;

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="sr-only">Кандидаты</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => {
            const selected = choice === c.id;
            return (
              <button
                key={c.id} type="button" onClick={() => setChoice(c.id)} aria-pressed={selected}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                  selected ? "border-accent bg-accent-soft" : "border-line bg-elev hover:bg-muted"
                }`}
              >
                <span className="text-2xl" aria-hidden>{c.avatarEmoji}</span>
                <span className="flex-1 font-semibold">{c.name}</span>
                {selected && <span aria-hidden>✅</span>}
              </button>
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
