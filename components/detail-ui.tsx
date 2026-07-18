import SectionAnchor from "@/components/section-anchor";
import TextWithLineBreaks from "@/components/text-with-line-breaks";
import { Flex, Heading, Table } from "@radix-ui/themes";
import type { ReactNode } from "react";

// Section heading shared across the project/sample/experiment/run detail pages:
// an h2, the copy-anchor, optional inline children, and an optional element
// pinned to the far right (a badge or button).
export function SectionHeader({
  id,
  title,
  children,
  right,
}: {
  id: string;
  title: string;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Flex id={id} align="center" gap="2">
      <Heading as="h2" weight="medium" size="6">
        {title}
      </Heading>
      <SectionAnchor id={id} />
      {children}
      {right && <Flex ml="auto">{right}</Flex>}
    </Flex>
  );
}

// Label→value metadata as a surface table. Rows with an empty value are dropped;
// renders nothing when none remain. A string value keeps its line breaks; any
// other node (e.g. links) is rendered as-is.
export function MetadataTable({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter((r) => Boolean(r[1]));
  if (shown.length === 0) return null;
  return (
    <Table.Root size="1" variant="surface">
      <Table.Body>
        {shown.map(([label, value], i) => (
          // Index key: GEO characteristics can repeat a label.
          <Table.Row key={`${label}-${i}`}>
            <Table.RowHeaderCell
              style={{ width: "200px", color: "var(--gray-11)" }}
            >
              {label}
            </Table.RowHeaderCell>
            <Table.Cell>
              {typeof value === "string" ? (
                <TextWithLineBreaks text={value} />
              ) : (
                value
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
