"use client";
import { ExternalLinkIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Badge, Button, Flex, Link, Popover, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";

type TaxonInfo = {
  commonName: string | null;
  rank: string | null;
  division: string | null;
  image: string | null;
  extract: string | null;
  wikiUrl: string | null;
};

// Taxonomy details from NCBI (rank/common name), image + blurb from Wikipedia.
// Both are best-effort: a failed leg just leaves its fields null. Both endpoints
// send Access-Control-Allow-Origin, so this runs straight from the browser.
const fetchTaxon = async (
  name: string,
  taxonId: string | null,
): Promise<TaxonInfo> => {
  const info: TaxonInfo = {
    commonName: null,
    rank: null,
    division: null,
    image: null,
    extract: null,
    wikiUrl: null,
  };
  if (taxonId) {
    try {
      const res = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=taxonomy&id=${encodeURIComponent(taxonId)}&retmode=json`,
      );
      const rec = res.ok ? (await res.json())?.result?.[taxonId] : null;
      if (rec) {
        info.commonName = rec.commonname || null;
        info.rank = rec.rank || null;
        info.division = rec.division || rec.genbankdivision || null;
      }
    } catch {
      /* NCBI unreachable — leave those fields null */
    }
  }
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
    );
    if (res.ok) {
      const data = await res.json();
      info.image = data?.thumbnail?.source || null;
      info.extract = data?.extract || null;
      info.wikiUrl = data?.content_urls?.desktop?.page || null;
    }
  } catch {
    /* no Wikipedia page — no image/blurb */
  }
  return info;
};

// Info button for the sample's organism, shown at the far end of the Sample
// metadata section heading — the sample-side analog of the experiment section's
// /e badge. Opens a popover with NCBI + Wikipedia details.
export function OrganismInfoButton({
  name,
  taxonId,
  size = "2",
}: {
  name: string;
  taxonId: string | null;
  /** Project pages sit it in a dense metadata row and want it smaller. */
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["taxon", name, taxonId],
    queryFn: () => fetchTaxon(name, taxonId),
    enabled: open,
    staleTime: Infinity,
  });
  const ncbiUrl = taxonId
    ? `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${taxonId}`
    : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button size={size} style={{ cursor: "pointer" }}>
          <InfoCircledIcon />
          <Text style={{ fontStyle: "italic" }}>{name}</Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="20rem" size={"1"}>
        {isLoading && (
          <Text size="2" color="gray">
            Loading…
          </Text>
        )}
        {data && (
          <Flex direction="column" gap="2">
            {data.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.image}
                alt={name}
                style={{
                  width: "100%",
                  maxHeight: "10rem",
                  objectFit: "cover",
                  borderRadius: "var(--radius-2)",
                }}
              />
            )}
            <Text size="3" weight="bold" style={{ fontStyle: "italic" }}>
              {name}
            </Text>
            {data.commonName && (
              <Text size="2" color="gray">
                {data.commonName?.charAt(0).toUpperCase() +
                  data.commonName?.slice(1)}
              </Text>
            )}
            <Flex gap="2" wrap="wrap">
              {data.rank && (
                <Badge size="1" variant="soft">
                  {data.rank}
                </Badge>
              )}
              {data.division && (
                <Badge size="1" color="gray" variant="soft">
                  {data.division}
                </Badge>
              )}
              {taxonId && (
                <Badge size="1" color="gray" variant="soft">
                  ID{" "}
                  <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                    {taxonId}
                  </span>
                </Badge>
              )}
            </Flex>
            {data.extract && (
              <Text size="1" color="gray">
                {data.extract}
                {data.wikiUrl && (
                  <>
                    {" "}
                    <Link
                      href={data.wikiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="1"
                      underline="hover"
                    >
                      Read more on Wikipedia.
                    </Link>
                  </>
                )}
              </Text>
            )}
            {ncbiUrl && (
              <Link
                href={ncbiUrl}
                target="_blank"
                rel="noopener noreferrer"
                size="1"
              >
                View on NCBI Taxonomy <ExternalLinkIcon />
              </Link>
            )}
          </Flex>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
