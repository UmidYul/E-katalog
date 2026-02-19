import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Providers } from "@/components/common/providers";
import { env } from "@/config/env";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: `${env.siteName} - Smart price comparison`,
    template: `%s | ${env.siteName}`
  },
  description: "Marketplace-grade price aggregation platform for electronics and tech products.",
  openGraph: {
    type: "website",
    siteName: env.siteName,
    title: `${env.siteName} - Smart price comparison`,
    description: "Compare prices, specs and offers across trusted stores.",
    url: env.appUrl
  },
  alternates: {
    canonical: env.appUrl
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}

