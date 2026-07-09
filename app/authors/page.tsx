"use client";

import SearchBar from "@/components/search-bar";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import * as React from "react";

export default function AuthorsIndexPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");

  const go = () => {
    const next = name.trim();
    if (next.length >= 2) router.push(`/authors/${encodeURIComponent(next)}`);
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
          Find projects by author
        </Heading>
        <Text
          size="2"
          align="center"
          style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
        >
          Enter a researcher&rsquo;s name to see every dataset they authored
          across GEO, SRA, ENA, and ArrayExpress.
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Author name"
              autoFocus
              aria-label="Author name"
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
