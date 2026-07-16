"use client";
import { SearchQueryProvider } from "@/context/search_query";
import { Theme } from "@radix-ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useState } from "react";
import CommandPalette from "./command-palette";
import DynamicFavicon from "./dynamic-favicon";
import KeyboardNavigator from "./keyboard-navigator";
import PwaRegistrar from "./pwa-registrar";
import { ToastProvider } from "./toast-provider";

export default function Wrapper({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Treat fetched data as fresh for a minute so remounts and
            // client-side navigation reuse the cache instead of refiring
            // the request, and don't refetch just because the tab regained
            // focus. Queries that need different behaviour (e.g. the stats
            // cards with staleTime: Infinity) still override these per-query.
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute={"class"} defaultTheme="dark">
        <DynamicFavicon />
        <PwaRegistrar />
        <SearchQueryProvider>
          {/* seqout-root-theme marks THIS Theme as the page-level one. Radix
              portals (popover/tooltip/dialog) render their own nested
              .radix-themes, so page-layout CSS must not key off that class. */}
          <Theme accentColor="indigo" className="seqout-root-theme">
            <ToastProvider>
              {children}
              <CommandPalette />
              <KeyboardNavigator />
            </ToastProvider>
          </Theme>
        </SearchQueryProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
