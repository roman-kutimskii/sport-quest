import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Операция «Анти-плед» 🎃",
  description: "Осенний спортивный квест: трекер тыковок",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Nav user={user ? { id: user.id, name: user.name, avatarEmoji: user.avatarEmoji, isAdmin: user.isAdmin } : null} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-fgm">
          3 сентября – 30 ноября · сезон охоты за тыковками 🎃
        </footer>
      </body>
    </html>
  );
}
