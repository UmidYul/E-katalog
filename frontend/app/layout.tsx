import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "@/components/common/providers";
import { env } from "@/config/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { toHtmlLang } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const locale = getRequestLocale();
  const t = createTranslator(locale);

  return {
    metadataBase: new URL(env.appUrl),
    applicationName: env.siteName,
    title: {
      default: t("rootMeta.titleDefault", { siteName: env.siteName }),
      template: t("rootMeta.titleTemplate", { siteName: env.siteName })
    },
    description: t("rootMeta.description"),
    keywords: [
      t("rootMeta.keywords1"),
      t("rootMeta.keywords2"),
      t("rootMeta.keywords3"),
      t("rootMeta.keywords4"),
      t("rootMeta.keywords5"),
      t("rootMeta.keywords6"),
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
      title: t("rootMeta.titleDefault", { siteName: env.siteName }),
      description: t("rootMeta.ogDescription"),
      url: env.appUrl,
      locale: locale === "uz-Cyrl-UZ" ? "uz_UZ" : "ru_UZ"
    },
    twitter: {
      card: "summary_large_image",
      title: t("rootMeta.titleDefault", { siteName: env.siteName }),
      description: t("rootMeta.twitterDescription")
    },
    alternates: {
      canonical: env.appUrl
    }
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getRequestLocale();

  return (
    <html lang={toHtmlLang(locale)} suppressHydrationWarning>
      <body>
        <Providers initialLocale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
