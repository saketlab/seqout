"use client";
import { SearchQueryProvider } from "@/context/search_query";
import { Theme } from "@radix-ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useState } from "react";
import CommandPalette from "./command-palette";
import DynamicFavicon from "./dynamic-favicon";
import KeyboardNavigator from "./keyboard-navigator";
import { ToastProvider } from "./toast-provider";

export default function Wrapper({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute={"class"} defaultTheme="dark">
        <DynamicFavicon />
        <SearchQueryProvider>
          <Theme accentColor="indigo">
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
