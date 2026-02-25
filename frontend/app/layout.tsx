import type { Metadata } from "next";
import { Manrope, Source_Sans_3 } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/common/providers";
import { RootShell } from "@/components/layout/root-shell";
import { env } from "@/config/env";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-heading",
  display: "swap"
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: `${env.siteName} - Сравнение цен на технику`,
    template: `%s | ${env.siteName}`
  },
  description: "Сравнивайте цены, магазины и характеристики техники в одном каталоге E-katalog.",
  openGraph: {
    type: "website",
    siteName: env.siteName,
    title: `${env.siteName} - Сравнение цен на технику`,
    description: "Проверенные магазины, актуальные цены, удобное сравнение и история стоимости.",
    url: env.appUrl
  },
  keywords: ["сравнение цен", "магазины", "каталог техники", "цены Узбекистан", "E-katalog"],
  alternates: {
    canonical: env.appUrl
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${sourceSans3.variable} ${manrope.variable} ${sourceSans3.className}`}>
        <Providers>
          <RootShell>{children}</RootShell>
        </Providers>
      </body>
    </html>
  );
}

