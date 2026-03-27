"use client";

import * as FlagIcons from "country-flag-icons/react/3x2";
import type { ReactElement, SVGProps } from "react";

type FlagComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const flags = FlagIcons as Record<string, FlagComponent>;

export default function CountryFlagIcon({
  code,
  label,
  style,
}: {
  code: string | null | undefined;
  label?: string;
  style?: SVGProps<SVGSVGElement>["style"];
}) {
  if (!code || code.length < 2) return null;

  const normalizedCode = code.toUpperCase();
  const Flag = flags[normalizedCode];
  if (!Flag) return null;

  return (
    <Flag
      role="img"
      aria-label={label ?? normalizedCode}
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
