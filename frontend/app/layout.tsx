import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Syne } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/common/providers";
import { env } from "@/config/env";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["700", "800"],
  display: "swap"
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500"],
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "600"],
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: `${env.siteName} - Сравнение цен на технику`,
    template: `%s | ${env.siteName}`
  },
  description: "Сравнивайте цены, магазины и характеристики техники в одном каталоге Doxx.",
  openGraph: {
    type: "website",
    siteName: env.siteName,
    title: `${env.siteName} - Сравнение цен на технику`,
    description: "Проверенные магазины, актуальные цены, удобное сравнение и история стоимости.",
    url: env.appUrl
  },
  keywords: ["сравнение цен", "магазины", "каталог техники", "цены Узбекистан", "Doxx"],
  alternates: {
    canonical: env.appUrl
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${syne.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
