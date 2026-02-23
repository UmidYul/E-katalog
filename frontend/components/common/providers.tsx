"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useEffect, useState } from "react";

import { useCompareStore } from "@/store/compare.store";
import { useProfileStore } from "@/store/profile.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

function PersistStoresHydrator() {
  useEffect(() => {
    void useCompareStore.persist.rehydrate();
    void useRecentlyViewedStore.persist.rehydrate();
    void useProfileStore.persist.rehydrate();
  }, []);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
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
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <PersistStoresHydrator />
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}

