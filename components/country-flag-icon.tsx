"use client";

import * as FlagIcons from "country-flag-icons/react/3x2";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { ReactElement, SVGProps } from "react";

type FlagComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const flags = FlagIcons as Record<string, FlagComponent>;

countries.registerLocale(enLocale);

/**
 * Normalize a country identifier (alpha-2, alpha-3, or English name) to
 * an ISO-3166-1 alpha-2 code. Returns null if nothing matches.
 */
function normalizeToAlpha2(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return flags[upper] ? upper : null;
  }

  if (trimmed.length === 3) {
    const alpha2 = countries.alpha3ToAlpha2(trimmed.toUpperCase());
    return alpha2 ?? null;
  }

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
