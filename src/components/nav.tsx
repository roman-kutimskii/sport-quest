"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavUser = { id: string; name: string; avatarEmoji: string; isAdmin: boolean } | null;

export function Nav({ user }: { user: NavUser }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/", label: "Таблица", show: true },
    { href: "/log", label: "＋ Отчёт", show: !!user },
    { href: user ? `/u/${user.id}` : "/login", label: "Мой профиль", show: !!user },
    { href: "/rules", label: "Правила", show: true },
    { href: "/results", label: "Итоги", show: true },
    { href: "/admin", label: "Админка", show: !!user?.isAdmin },
  ].filter((l) => l.show);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 py-1 font-bold">
          <span className="text-2xl">🎃</span>
          <span>Анти-плед</span>
        </Link>
        <nav className="hidden flex-1 items-center gap-1 text-sm sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition ${
                isActive(l.href) ? "bg-accent-soft text-accent-strong" : "text-fgm hover:bg-muted hover:text-fg"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {user ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xl" aria-hidden>{user.avatarEmoji}</span>
              <span className="hidden font-medium sm:inline">{user.name}</span>
              <form action="/logout" method="post"><button className="text-xs text-fgm hover:text-fg">выйти</button></form>
            </div>
          ) : (
            <Link href="/login" className="btn-ghost !py-1.5">Войти</Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label="Меню"
            className="rounded-lg p-2 text-fgm transition hover:bg-muted hover:text-fg sm:hidden"
          >
            <span aria-hidden className="block text-lg leading-none">{open ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" className="border-t border-line px-4 pb-3 pt-2 sm:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive(l.href) ? "bg-accent-soft text-accent-strong" : "text-fgm hover:bg-muted hover:text-fg"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
