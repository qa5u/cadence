import type { Metadata } from "next";
import { Bricolage_Grotesque, Newsreader, Fraunces, Inter } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cadence: Every sales call, turned into action.",
  description: "Paste or upload a sales or business call transcript. Cadence checks it, then writes the notes.",
  icons: { icon: [{ url: "/favicon.png", sizes: "256x256", type: "image/png" }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${newsreader.variable} ${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-[var(--bg)] text-[var(--ink)] font-inter antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
