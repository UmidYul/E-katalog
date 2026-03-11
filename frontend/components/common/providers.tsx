"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useEffect, useState } from "react";

import { LocaleProvider } from "@/components/common/locale-provider";
import { useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { Toaster } from "@/components/ui/toaster";
import { useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import { useProfileStore } from "@/store/profile.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import type { Locale } from "@/lib/i18n/types";

function PersistStoresHydrator() {
  useEffect(() => {
    void useCompareStore.persist.rehydrate();
    void useRecentlyViewedStore.persist.rehydrate();
    void useProfileStore.persist.rehydrate();
    void usePriceAlertsStore.persist.rehydrate();
  }, []);

  return null;
}

function PriceAlertsServerHydrator() {
  const serverPriceAlerts = useUserPriceAlerts();
  const mergeServerMetas = usePriceAlertsStore((s) => s.mergeServerMetas);

  useEffect(() => {
    if (!serverPriceAlerts.data?.length) return;
    mergeServerMetas(serverPriceAlerts.data);
  }, [mergeServerMetas, serverPriceAlerts.data]);

  return null;
}

export function Providers({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false
          },
          mutations: {
            retry: 1
          }
        }
      })
  );

  return (
    <LocaleProvider initialLocale={initialLocale}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryClientProvider client={queryClient}>
          <PersistStoresHydrator />
          <PriceAlertsServerHydrator />
          {children}
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}

