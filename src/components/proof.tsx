import { isVideoUrl } from "@/lib/upload";

export function Proof({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) return <span className="text-xs text-fgm">без фото</span>;
  if (isVideoUrl(url)) return <video src={url} controls preload="metadata" className={`rounded-lg ${className}`} />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="подтверждение" className={`rounded-lg object-cover ${className}`} loading="lazy" />
    </a>
  );
}
