"use client";

import { DB_BADGE_FG, DB_COLOR_MAP, type DbSource } from "@/utils/db-colors";
import { Badge } from "@radix-ui/themes";
import type { ComponentProps, CSSProperties } from "react";

type Props = Omit<ComponentProps<typeof Badge>, "color"> & {
  db?: DbSource | null;
};

/** A Badge in its source's colour. Plain Badge if the source is unknown. */
export default function DbBadge({ db, className, style, ...rest }: Props) {
  if (!db) return <Badge className={className} style={style} {...rest} />;

  const vars = {
    "--db": DB_COLOR_MAP[db].hex,
    "--db-fg": DB_BADGE_FG[db].light,
    "--db-fg-dark": DB_BADGE_FG[db].dark,
  } as CSSProperties;

  return (
    <Badge
      className={className ? `db-badge ${className}` : "db-badge"}
      style={{ ...vars, ...style }}
      {...rest}
    />
  );
}
