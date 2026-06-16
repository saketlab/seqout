"use client";
import { LAST_INDEX_REFRESH } from "@/utils/constants";
import { useLastUpdated } from "@/utils/useStats";
import { Text } from "@radix-ui/themes";

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function IndexRefreshed() {
  const { data } = useLastUpdated();
  const label = data?.last_updated
    ? formatLocal(data.last_updated)
    : LAST_INDEX_REFRESH;
  return (
    <Text size="1" style={{ color: "var(--gray-11)" }}>
      Index refreshed {label}
    </Text>
  );
}
