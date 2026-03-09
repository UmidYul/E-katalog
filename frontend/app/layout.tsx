import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "@/components/common/providers";
import { env } from "@/config/env";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  applicationName: env.siteName,
  title: {
    default: `${env.siteName} - сравнение цен на технику и электронику`,
    template: `%s | ${env.siteName}`
  },
  description:
    "Сравнивайте цены, магазины и характеристики смартфонов, ноутбуков и другой техники в одном каталоге.",
  keywords: [
    "сравнение цен",
    "цены на технику",
    "каталог электроники",
    "смартфоны цены",
    "ноутбуки цены",
    "онлайн каталог Узбекистан",
    env.siteName
  ],
  category: "shopping",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    siteName: env.siteName,
    title: `${env.siteName} - сравнение цен на технику и электронику`,
    description:
      "Проверенные магазины, актуальные цены и удобное сравнение предложений по технике и электронике.",
    url: env.appUrl,
    locale: "ru_UZ"
  },
  twitter: {
    card: "summary_large_image",
    title: `${env.siteName} - сравнение цен на технику и электронику`,
    description: "Сравнивайте цены, магазины и характеристики техники в одном каталоге."
  },
  alternates: {
    canonical: env.appUrl
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
