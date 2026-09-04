"use client";

import { useActionState, useEffect, useState } from "react";
import { AVATAR_EMOJIS } from "@/lib/avatars";
import { updateProfile, type ProfileState } from "./actions";

export function ProfileForm({ name: initialName, avatarEmoji: initialEmoji }: { name: string; avatarEmoji: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [saved, setSaved] = useState(false);

  // A successful save collapses the form; the confirmation shows as a toast instead.
  const [state, action, pending] = useActionState<ProfileState, FormData>(async (prev, formData) => {
    const result = await updateProfile(prev, formData);
    if (result?.ok) {
      setOpen(false);
      setSaved(true);
    }
    return result;
  }, undefined);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  // w-full makes the toast wrap onto its own line inside the button row.
  const toast = saved && (
    <p className="w-full rounded-xl bg-ok-soft p-3 text-sm text-ok" role="status">Профиль обновлён 🎃</p>
  );

  if (!open) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost w-full sm:w-auto">
          ✏️ Изменить профиль
        </button>
        {toast}
      </>
    );
  }

  return (
    <form action={action} className="w-full space-y-4 rounded-xl border border-line bg-muted p-4">
      <div>
        <label className="label" htmlFor="name">Имя</label>
        <input
          id="name" name="name" className="input" value={name} maxLength={60} required
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <fieldset>
        <legend className="label">Иконка</legend>
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_EMOJIS.map((e) => (
            <button
              key={e} type="button" onClick={() => setEmoji(e)} aria-label={e} aria-pressed={emoji === e}
              className={`rounded-xl border px-2 py-1 text-xl transition ${emoji === e ? "border-accent bg-accent-soft" : "border-line bg-elev hover:bg-muted"}`}
            >
              {e}
            </button>
          ))}
        </div>
        <input type="hidden" name="avatarEmoji" value={emoji} />
      </fieldset>

      {state?.error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Сохраняю…" : "Сохранить"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  );
}
