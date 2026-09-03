import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Вход 🎃</h1>
        <p className="mt-2 text-sm text-fgm">
          В трекер можно попасть только по личной ссылке-приглашению. Попроси её у организатора квеста
          и открой в браузере — вход произойдёт автоматически.
        </p>
        {error && (
          <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            Ссылка не подошла. Проверь, что скопировал её целиком, или попроси новую.
          </p>
        )}
        <form action="/login/token" method="get" className="mt-6 space-y-3">
          <label className="label" htmlFor="token">Или вставь код из ссылки</label>
          <input id="token" name="token" className="input" placeholder="например: cm1abc..." />
          <button className="btn-primary w-full">Войти</button>
        </form>
      </div>
    </div>
  );
}
