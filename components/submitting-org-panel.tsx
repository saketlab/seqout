"use client";

import { Box, Flex, Heading, Table, Text, Tooltip } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import dynamic from "next/dynamic";
import React from "react";

export type CenterInfo = {
  organization: string | null;
  department: string | null;
  place_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  formatted_address: string | null;
};

type Props = {
  center: CenterInfo | CenterInfo[] | null | undefined;
};

const LeafletMap = dynamic(() => import("./submitting-org-map"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "100%",
        minHeight: "300px",
        width: "100%",
        borderRadius: "8px",
        background: "var(--gray-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text size="2" color="gray">
        Loading map...
      </Text>
    </div>
  ),
});

type DetailRow = { label: string; value: string };

function buildDetails(c: CenterInfo): DetailRow[] {
  const rows: DetailRow[] = [];
  if (c.organization) rows.push({ label: "Organization", value: c.organization });
  if (c.department) rows.push({ label: "Department", value: c.department });
  if (c.place_name) rows.push({ label: "Place", value: c.place_name });
  if (c.city) rows.push({ label: "City", value: c.city });
  if (c.state) rows.push({ label: "State", value: c.state });
  if (c.country) rows.push({ label: "Country", value: c.country });
  if (c.country_code && c.country_code !== c.country)
    rows.push({ label: "Country code", value: c.country_code });
  if (c.postcode) rows.push({ label: "Postal code", value: c.postcode });
  if (c.latitude != null)
    rows.push({ label: "Latitude", value: c.latitude.toFixed(6) });
  if (c.longitude != null)
    rows.push({ label: "Longitude", value: c.longitude.toFixed(6) });
  if (c.formatted_address)
    rows.push({ label: "Address", value: c.formatted_address });
  return rows;
}

export default function SubmittingOrgPanel({ center }: Props) {
  const entries = React.useMemo(() => {
    if (!center) return [];
    const arr = Array.isArray(center) ? center : [center];
    return arr.filter((c) => c.organization && c.organization !== "GEO");
  }, [center]);

  const markersWithCoords = React.useMemo(
    () => entries.filter((c) => c.latitude != null && c.longitude != null),
    [entries],
  );

  if (entries.length === 0) return null;

  return (
    <Flex direction="column" gap="4" mt="4">
      <Flex align="center" gap="2">
        <Heading as="h2" weight="medium" size="6">
          Submitting organization
        </Heading>
        <Tooltip content="Derived from metadata using third-party geocoding services">
          <InfoCircledIcon
            style={{ cursor: "help" }}
            aria-label="How the submitting organization is determined"
          />
        </Tooltip>
      </Flex>
      <Flex
        direction={{ initial: "column", md: "row" }}
        gap="4"
        align="stretch"
      >
        <Flex
          direction="column"
          gap="4"
          style={{ flex: "1 1 0", minWidth: 0, width: "100%" }}
        >
          {entries.map((c, i) => {
            const details = buildDetails(c);
            return (
              <Flex key={i} direction="column" gap="2">
                <Table.Root variant="surface" size="1">
                  <Table.Body>
                    {details.map((row) => (
                      <Table.Row key={row.label}>
                        <Table.RowHeaderCell
                          style={{ width: "140px", whiteSpace: "nowrap" }}
                        >
                          <Text size="2" weight="medium">
                            {row.label}
                          </Text>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text size="2">{row.value}</Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Flex>
            );
          })}
        </Flex>
        {markersWithCoords.length > 0 && (
          <Box
            style={{
              flex: "1 1 0",
              minWidth: 0,
              alignSelf: "stretch",
              display: "flex",
              minHeight: "300px",
            }}
          >
            <Box style={{ flex: 1, minHeight: "300px" }}>
              <LeafletMap markers={markersWithCoords} />
            </Box>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}
