"use client";

import ChartFooter, { chartFooterEvents } from "@/components/chart-footer";
import SectionAnchor from "@/components/section-anchor";
import { CHART_SERIES_PALETTE, getApexChartTheme } from "@/utils/chart-theme";
import exportExperimentsToCsv from "@/utils/exportCsv";
import { humanize } from "@/utils/format";
import { useEnrichedCrosstab } from "@/utils/useStats";
import { useReducedMotion } from "@/utils/useReducedMotion";
import {
  Flex,
  Heading,
  Select,
  Text,
} from "@radix-ui/themes";
import type { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Keep `value`s in sync with backend ENRICHED_CROSSTAB_COLUMNS.
const COLUMNS: { value: string; label: string }[] = [
  { value: "organism", label: "Organism" },
  { value: "tissue", label: "Tissue" },
  { value: "cell_type", label: "Cell type" },
  { value: "disease", label: "Disease" },
  { value: "assay", label: "Assay" },
  { value: "development_stage", label: "Development stage" },
  { value: "sample_type", label: "Sample type" },
  { value: "sex", label: "Sex" },
  { value: "ethnicity", label: "Ethnicity" },
  { value: "phenotype", label: "Phenotype" },
  { value: "genetic_modification", label: "Genetic modification" },
];

const LABEL = Object.fromEntries(COLUMNS.map((c) => [c.value, c.label]));
const TOP_GROUPS = 12;
const TOP_BREAKDOWN = 7;
const OTHER_COLOR = "#9ca3af";

function ColumnSelect({
  value,
  onChange,
  exclude,
}: {
  value: string;
  onChange: (v: string) => void;
  exclude: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger />
      <Select.Content>
        {COLUMNS.filter((c) => c.value !== exclude).map((c) => (
          <Select.Item key={c.value} value={c.value}>
            {c.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export default function StatsEnrichedCard() {
  const [group, setGroup] = useState("organism");
  const [breakdown, setBreakdown] = useState("tissue");
  const { data, isLoading } = useEnrichedCrosstab(group, breakdown);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const reduced = useReducedMotion();

  const { series, categories } = useMemo(() => {
    const groups = (data?.groups ?? []).slice(0, TOP_GROUPS);
    if (groups.length === 0) return { series: [], categories: [] };

    const totalByValue = new Map<string, number>();
    for (const g of groups) {
      for (const b of g.breakdowns) {
        totalByValue.set(b.value, (totalByValue.get(b.value) ?? 0) + b.count);
      }
    }
    const topValues = [...totalByValue.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_BREAKDOWN)
      .map(([v]) => v);

    const cats = groups.map((g) => `${g.value} (${g.distinct})`);
    const named = topValues.map((bv) => ({
      name: bv,
      data: groups.map(
        (g) => g.breakdowns.find((b) => b.value === bv)?.count ?? 0,
      ),
    }));
    const other = {
      name: "Other",
      data: groups.map((g) => {
        const shown = g.breakdowns
          .filter((b) => topValues.includes(b.value))
          .reduce((sum, b) => sum + b.count, 0);
        return Math.max(0, g.total - shown);
      }),
    };
    const hasOther = other.data.some((v) => v > 0);
    return {
      series: hasOther ? [...named, other] : named,
      categories: cats,
    };
  }, [data]);

  const chartOptions = useMemo<ApexOptions>(() => {
    const theme = getApexChartTheme(isDark);
    const colors = [...CHART_SERIES_PALETTE.slice(0, TOP_BREAKDOWN), OTHER_COLOR];
    return {
      chart: {
        id: "seqout-enriched-crosstab",
        type: "bar",
        stacked: true,
        background: theme.background,
        toolbar: { show: false },
        foreColor: theme.foreColor,
        animations: { enabled: !reduced },
        events: chartFooterEvents,
      },
      title: {
        text: `${LABEL[breakdown]} by ${LABEL[group].toLowerCase()}`,
        align: "left",
        style: {
          fontSize: "16px",
          fontWeight: "600",
          fontFamily:
            "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          color: theme.titleColor,
        },
      },
      subtitle: {
        text: `Top ${LABEL[breakdown].toLowerCase()} values within each ${LABEL[
          group
        ].toLowerCase()}; (n) = distinct ${LABEL[breakdown].toLowerCase()} types`,
        align: "left",
        style: {
          fontSize: "12px",
          fontFamily:
            "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          color: theme.subtitleColor,
        },
      },
      plotOptions: { bar: { horizontal: true, borderRadius: 2 } },
      dataLabels: { enabled: false },
      xaxis: {
        categories,
        labels: { formatter: (v) => humanize(Number(v)) },
        title: { text: "Samples" },
      },
      colors,
      legend: { position: "bottom", labels: { colors: theme.legendLabelColor } },
      grid: {
        strokeDashArray: 4,
        borderColor: theme.gridBorderColor,
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        y: { formatter: (v) => `${v.toLocaleString()} samples` },
      },
    };
  }, [group, breakdown, categories, isDark, reduced]);

  function exportCsv() {
    if (!data) return;
    const rows = data.groups.flatMap((g) =>
      g.breakdowns.map((b) => ({
        [group]: g.value,
        [breakdown]: b.value,
        count: b.count,
      })),
    );
    exportExperimentsToCsv(rows, `seqout-${breakdown}-by-${group}.csv`);
  }

  return (
    <Flex direction="column" width="100%" py={{ initial: "4", md: "5" }}>
      <Flex justify="between" align="center" mb="4" gap="3" wrap="wrap">
        <Flex align="center" gap="2">
          <Heading as="h2" size="5" weight="bold" ml="1">
            Enriched metadata
          </Heading>
          <SectionAnchor id="enriched" />
        </Flex>
        <Flex align="center" gap="2" wrap="wrap">
          <ColumnSelect value={group} onChange={setGroup} exclude={breakdown} />
          <Text size="2" color="gray">
            by
          </Text>
          <ColumnSelect
            value={breakdown}
            onChange={setBreakdown}
            exclude={group}
          />
        </Flex>
      </Flex>

      {isLoading ? (
        <Flex align="center" justify="center" height="420px" width="100%">
          <Text color="gray" size="2">
            Crunching numbers…
          </Text>
        </Flex>
      ) : series.length === 0 ? (
        <Text color="gray" size="2" ml="1">
          No standardised data for this combination yet.
        </Text>
      ) : (
        <>
          <Chart
            type="bar"
            options={chartOptions}
            series={series}
            height={Math.max(360, categories.length * 32 + 120)}
            width="100%"
          />
          <Flex justify="end" mt="2">
            <Text
              size="1"
              color="gray"
              onClick={exportCsv}
              style={{ cursor: "pointer" }}
            >
              Download CSV
            </Text>
          </Flex>
        </>
      )}
      <ChartFooter chartId="seqout-enriched-crosstab" />
    </Flex>
  );
}
