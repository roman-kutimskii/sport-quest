export function Pumpkins({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 tabular-nums ${className}`}>
      <span className="font-bold">{n}</span>
      <span aria-hidden>🎃</span>
    </span>
  );
}

export function StreakBadge({ n }: { n: number }) {
  if (n <= 0) return <span className="text-fgm">—</span>;
  return (
    <span className="chip bg-accent-soft text-accent-strong">
      🔥 {n}
    </span>
  );
}

export function Invulnerable({ until }: { until: string | null }) {
  if (!until) return null;
  return <span className="chip bg-leaf-soft text-leaf" title={`Титул действует до ${until}`}>🛡️ Неуязвимый</span>;
}
