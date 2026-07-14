"use client";

import SearchBar from "@/components/search-bar";
import { ARCHIVE_LIST_TEXT } from "@/utils/constants";
import { isPmid, pmidHref } from "@/utils/project";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import * as React from "react";

export default function PublicationsIndexPage() {
  const router = useRouter();
  const [pmid, setPmid] = React.useState("");

  const go = () => {
    const next = pmid.trim();
    if (isPmid(next)) router.push(pmidHref(next));
  };

  return (
    <>
      <SearchBar />

      <Flex
        direction="column"
        align="center"
        justify="center"
        gap="4"
        px="4"
        style={{ minHeight: "60vh" }}
      >
        <Heading size="6" align="center">
          Find projects by publication
        </Heading>
        <Text
          size="2"
          align="center"
          style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
        >
          Enter a PubMed ID to see every dataset linked to that paper across{" "}
          {ARCHIVE_LIST_TEXT}.
        </Text>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
          style={{ width: "100%", maxWidth: "28rem" }}
        >
          <Flex gap="2">
            <TextField.Root
              size="3"
              value={pmid}
              onChange={(e) => setPmid(e.target.value)}
              placeholder="PMID (e.g. 29116155)"
              inputMode="numeric"
              autoFocus
              aria-label="PMID"
              style={{ flex: 1 }}
            />
            <Button size="3" type="submit">
              <MagnifyingGlassIcon />
              Search
            </Button>
          </Flex>
        </form>
      </Flex>
    </>
  );
}
