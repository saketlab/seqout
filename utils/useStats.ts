import { getJson } from "@/utils/api";
import type { LastUpdated, SourceTotals } from "@/utils/types";
import { useQuery } from "@tanstack/react-query";

const ONE_DAY = 24 * 60 * 60 * 1000;

export function useSourceTotals() {
  return useQuery({
    queryKey: ["source-totals"],
    queryFn: () => getJson<SourceTotals>("/stats/source-totals"),
    staleTime: ONE_DAY,
  });
}

export function useLastUpdated() {
  return useQuery({
    queryKey: ["last-updated"],
    queryFn: () => getJson<LastUpdated>("/stats/last-updated"),
    staleTime: ONE_DAY,
  });
}
