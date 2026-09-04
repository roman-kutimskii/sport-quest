import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { telegramEnabled } from "@/lib/telegram";

const ERRORS: Record<string, string> = {
  tg_invalid: "Не удалось войти через Telegram. Попробуй ещё раз.",
  tg_inactive: "Твой аккаунт отключён организатором.",
  tg_disabled: "Вход через Telegram сейчас выключен.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { error } = await searchParams;
  const errorText = typeof error === "string" ? ERRORS[error] ?? ERRORS.tg_invalid : null;
  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Вход 🎃</h1>
        <p className="mt-2 text-sm text-fgm">Войди через Telegram — аккаунт в трекере создастся автоматически.</p>
        {errorText && (
          <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">{errorText}</p>
        )}
        {telegramEnabled() ? (
          <a href="/login/telegram" className="btn-primary mt-5 flex w-full items-center justify-center gap-2 !bg-[#2AABEE] hover:!bg-[#229ED9]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.56 8.16-1.96 9.26c-.15.66-.54.82-1.09.51l-3-2.21-1.45 1.4c-.16.16-.3.3-.6.3l.21-3.05 5.56-5.02c.24-.21-.05-.33-.37-.12l-6.87 4.33-2.96-.93c-.64-.2-.66-.64.14-.95l11.57-4.46c.54-.2 1.01.13.82.94z"/></svg>
            Войти через Telegram
          </a>
        ) : (
          <p className="mt-5 text-sm text-fgm">{ERRORS.tg_disabled}</p>
        )}
      </div>
    </div>
  );
}
