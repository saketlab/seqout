"use client";
import { LAST_INDEX_REFRESH } from "@/utils/constants";
import { DB_LABELS, DB_ORDER } from "@/utils/db-colors";
import { useLastUpdated } from "@/utils/useStats";
import { Flex, Text, Tooltip } from "@radix-ui/themes";

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
  const perDb = (
    <Flex direction="column" gap="1">
      {DB_ORDER.filter((k) => bySource?.[k]).map((k) => (
        <Text key={k} size="1">
          {DB_LABELS[k]}: {formatLocal(bySource?.[k] as string)}
        </Text>
      ))}
    </Flex>
  );

  return (
    <Tooltip content={perDb}>
      <Text size="1" style={{ color: "var(--gray-11)", cursor: "help" }}>
        Index refreshed {formatLocal(data.last_updated)}
      </Text>
    </Tooltip>
  );
}
