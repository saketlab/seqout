"use client";
import { DownloadFastqSection } from "@/components/sra-project-page";
import { getJsonOrNull } from "@/utils/api";
import { normalizeAliases } from "@/utils/project";
import { useQuery } from "@tanstack/react-query";
import React from "react";

type RunsData = React.ComponentProps<typeof DownloadFastqSection>["runsData"];

export default function LinkedSraFastq({
  aliasField,
  agGridThemeClassName,
}: {
  aliasField: string | string[] | null | undefined;
  agGridThemeClassName: string;
}) {
  const sraAliases = React.useMemo(
    () =>
      normalizeAliases(aliasField).filter((a) =>
        /^[SED]RP\d+$/.test(a.toUpperCase()),
      ),
    [aliasField],
  );
  const { data } = useQuery({
    queryKey: ["linked-sra-runs", sraAliases],
    queryFn: async () => {
      const entries = await Promise.all(
        sraAliases.map(async (accession) => ({
          accession,
          runsData: await getJsonOrNull<RunsData>(`/project/${accession}/runs`),
        })),
      );
      return entries.filter(
        (e): e is { accession: string; runsData: RunsData } =>
          !!e.runsData && e.runsData.total_runs > 0,
      );
    },
    enabled: sraAliases.length > 0,
  });
  const expTitleMap = React.useMemo(() => new Map<string, string>(), []);

  if (!data || data.length === 0) return null;
  return (
    <>
      {data.map(({ accession, runsData }) => (
        <DownloadFastqSection
          key={accession}
          accession={accession}
          runsData={runsData}
          agGridThemeClassName={agGridThemeClassName}
          expTitleMap={expTitleMap}
        />
      ))}
    </>
  );
}
