"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavUser = { id: string; name: string; avatarEmoji: string; isAdmin: boolean } | null;

export function Nav({ user }: { user: NavUser }) {
  const path = usePathname();
  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: "Таблица", show: true },
    { href: "/log", label: "＋ Отчёт", show: !!user },
    { href: user ? `/u/${user.id}` : "/login", label: "Мой профиль", show: !!user },
    { href: "/rules", label: "Правила", show: true },
    { href: "/results", label: "Итоги", show: true },
    { href: "/admin", label: "Админка", show: !!user?.isAdmin },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="text-2xl">🎃</span>
          <span className="hidden sm:inline">Анти-плед</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
          {links.filter((l) => l.show).map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition ${
                  active ? "bg-accent-soft text-accent-strong" : "text-fgm hover:bg-muted hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        {user ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xl" aria-hidden>{user.avatarEmoji}</span>
            <span className="hidden font-medium sm:inline">{user.name}</span>
            <Link href="/logout" className="text-xs text-fgm hover:text-fg">выйти</Link>
          </div>
        ) : (
          <Link href="/login" className="btn-ghost !py-1.5">Войти</Link>
        )}
      </div>
    </header>
  );
}
