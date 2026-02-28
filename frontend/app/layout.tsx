import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "@/components/common/providers";
import { env } from "@/config/env";

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
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
