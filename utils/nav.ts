import {
  BarChartIcon,
  CodeIcon,
  InfoCircledIcon,
  KeyboardIcon,
  MagicWandIcon,
  SewingPinIcon,
} from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { createElement } from "react";

/**
 * Single source of truth for the global navigation items.
 *
 * Used by both `components/navbar.tsx` (homepage) and
 * `components/search-bar.tsx` (every other page) so there's no drift.
 *
 * Order matters: items render left-to-right in the desktop nav.
 */
export type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  external?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "About",
    href: "/faq",
    icon: createElement(InfoCircledIcon),
  },
  {
    label: "CLI",
    href: "https://saket-choudhary.me/pysradb/index.html",
    external: true,
    icon: createElement(KeyboardIcon),
  },
  {
    label: "Map",
    href: "/map",
    icon: createElement(SewingPinIcon),
  },
  {
    label: "API",
    href: "/api-docs",
    icon: createElement(CodeIcon),
  },
  {
    label: "MCP",
    href: "/mcp",
    icon: createElement(MagicWandIcon),
  },
  {
    label: "Stats",
    href: "/stats",
    icon: createElement(BarChartIcon),
  },
] as const;
