"use client";
import { LAST_INDEX_REFRESH } from "@/utils/constants";
import { DB_LABELS, DB_ORDER } from "@/utils/db-colors";
import { useLastUpdated } from "@/utils/useStats";
import { Text, Tooltip } from "@radix-ui/themes";
import React from "react";

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function IndexRefreshed() {
  const { data } = useLastUpdated();

  if (!data?.last_updated) {
    return (
      <Text size="1" style={{ color: "var(--gray-11)" }}>
        Index refreshed {LAST_INDEX_REFRESH}
      </Text>
    );
  }

  const bySource = data.by_source;
  const rows = DB_ORDER.filter((k) => bySource?.[k]);
  // Tooltip content renders inside <Text as="p">, so keep it inline (spans + <br/>);
  // a <div>/<Flex> here breaks HTML nesting and hydration.
  const perDb = rows.map((k, i) => (
    <React.Fragment key={k}>
      {i > 0 && <br />}
      {DB_LABELS[k]}: {formatLocal(bySource?.[k] as string)}
    </React.Fragment>
  ));

  return (
    <Tooltip content={perDb}>
      <Text size="1" style={{ color: "var(--gray-11)", cursor: "help" }}>
        Index refreshed {formatLocal(data.last_updated)}
      </Text>
    </Tooltip>
  );
}
