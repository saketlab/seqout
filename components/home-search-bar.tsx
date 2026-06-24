"use client";

import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import Image from "next/image";
import Link from "next/link";
import HeroSearchBar from "./hero-search-bar";

const EXAMPLE_ACCESSIONS: readonly { accession: string; href: string }[] = [
  { accession: "GSE196830", href: "/p/GSE196830" },
  { accession: "SRP116528", href: "/p/SRP116528" },
] as const;

export default function HomeSearchBar() {
  return (
    <Flex
      justify="center"
      align="center"
      direction="column"
      gap="5"
      mt={{ initial: "3rem", md: "5rem" }}
      px="4"
    >
      {/* Logo — monotonic width progression: small on mobile, bigger on
          desktop. The previous values shrank at md and grew again at lg,
          which was a responsive bug. */}
      <Box
        pb="2"
        width={{ initial: "18rem", sm: "22rem", md: "24rem", lg: "28rem" }}
        style={{ position: "relative", aspectRatio: "619/103" }}
      >
        <Image
          className="logo-light"
          src="/logo-light.svg"
          alt="seqout"
          fill
          sizes="(max-width: 640px) 18rem, (max-width: 768px) 22rem, (max-width: 1024px) 24rem, 28rem"
          style={{ objectFit: "contain" }}
          priority
        />
        <Image
          className="logo-dark"
          src="/logo-dark.svg"
          alt="seqout"
          fill
          sizes="(max-width: 640px) 18rem, (max-width: 768px) 22rem, (max-width: 1024px) 24rem, 28rem"
          style={{ objectFit: "contain" }}
          priority
        />
      </Box>

      {/* Tagline — single punch line in Geist Sans with negative tracking.
          Quiet on purpose: the search input should still be the visual
          focal point, not the tagline. */}
      <Text
        size={{ initial: "3", md: "4" }}
        weight="medium"
        align="center"
        color="gray"
        style={{ letterSpacing: "-0.02em" }}
      >
        Search public sequencing datasets across GEO, SRA, ENA &amp;
        ArrayExpress
      </Text>

      <HeroSearchBar />

      {/* Teaching empty state: two real accession chips + a keyword hint.
          First-time users learn the accession format; returning users get
          a one-click fast path to canonical examples. */}
      <Flex
        direction="column"
        gap="2"
        align="center"
        style={{ maxWidth: "42rem" }}
      >
        <Text size="1" align="center" style={{ color: "var(--gray-11)" }}>
          Search by keyword &mdash;{" "}
          <Link href="/search?q=naked+mole+rat" className="seqout-inline-link">
            organism
          </Link>
          ,{" "}
          <Link href="/search?q=fatty+liver" className="seqout-inline-link">
            disease
          </Link>
          ,{" "}
          <Link href="/search?q=PVALB" className="seqout-inline-link">
            gene
          </Link>
          , or{" "}
          <Link href="/search?q=scrna-seq" className="seqout-inline-link">
            method
          </Link>
          .
        </Text>
        <Flex gap="2" align="center" justify="center" wrap="wrap">
          <Text size="1" style={{ color: "var(--gray-11)" }}>
            Or try an accession:
          </Text>
          {EXAMPLE_ACCESSIONS.map(({ accession, href }) => (
            <Link
              key={accession}
              href={href}
              style={{ textDecoration: "none" }}
            >
              <Badge
                size="2"
                variant="soft"
                color="gray"
                className="seqout-accession"
                style={{ cursor: "pointer" }}
              >
                {accession}
              </Badge>
            </Link>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}
