"use client";

import * as FlagIcons from "country-flag-icons/react/3x2";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { ReactElement, SVGProps } from "react";

type FlagComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const flags = FlagIcons as Record<string, FlagComponent>;

// Register the English locale once for alpha-3 → alpha-2 lookups + country
// name → alpha-2 lookups. Safe to call repeatedly.
countries.registerLocale(enLocale);

/**
 * Normalize a country identifier to an ISO-3166-1 alpha-2 code.
 *
 * Backends in this project return country codes inconsistently:
 *   - The `/search` API returns 2-letter alpha-2 codes ("US", "GB")
 *   - The `/project/{accession}` API returns 3-letter alpha-3 codes ("USA")
 *   - Some endpoints return the full country name ("United States")
 *
 * This helper accepts any of those shapes and returns a 2-letter code (or
 * null if nothing matches), so every `CountryFlagIcon` caller gets a flag
 * without having to know which API it's talking to.
 */
function normalizeToAlpha2(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;

  // Already alpha-2? Verify it's a known code (prevents "ZZ" rendering).
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return flags[upper] ? upper : null;
  }

  // Alpha-3 (e.g., "USA" → "US").
  if (trimmed.length === 3) {
    const alpha2 = countries.alpha3ToAlpha2(trimmed.toUpperCase());
    return alpha2 ?? null;
  }

  // Full country name (e.g., "United States" → "US"). Handles common
  // English aliases via i18n-iso-countries' built-in name table.
  const alpha2FromName = countries.getAlpha2Code(trimmed, "en");
  return alpha2FromName ?? null;
}

export default function CountryFlagIcon({
  code,
  label,
  style,
}: {
  code: string | null | undefined;
  label?: string;
  style?: SVGProps<SVGSVGElement>["style"];
}) {
  const alpha2 = normalizeToAlpha2(code);
  if (!alpha2) return null;

  const Flag = flags[alpha2];
  if (!Flag) return null;

  return (
    <Flag
      role="img"
      aria-label={label ?? alpha2}
      style={{
        width: "1rem",
        height: "auto",
        borderRadius: "2px",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
