"use client";
import { SearchQueryProvider } from "@/context/search_query";
import { Theme } from "@radix-ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useState } from "react";
import CommandPalette from "./command-palette";
import DynamicFavicon from "./dynamic-favicon";
import { ToastProvider } from "./toast-provider";

export default function Wrapper({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // Memoize the QueryClient so it isn't recreated on every render — the
  // previous `new QueryClient()` inline call would drop the cache every
  // time React re-ran this component. Saved in practice by Next.js only
  // mounting <Wrapper> once per session, but useState is the correct
  // pattern and removes a latent footgun.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute={"class"} defaultTheme="dark">
        <DynamicFavicon />
        <SearchQueryProvider>
          <Theme accentColor="indigo">
            <ToastProvider>
              {children}
              {/* Cmd+K command palette — replaces the previous global
                  search shortcut. Mounted at app root so it's available
                  on every route. */}
              <CommandPalette />
            </ToastProvider>
          </Theme>
        </SearchQueryProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
