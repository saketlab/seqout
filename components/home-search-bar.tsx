"use client";

import { Box, Flex, Text } from "@radix-ui/themes";
import { useTheme } from "next-themes";
import Image from "next/image";
import HeroSearchBar from "./hero-search-bar";

export default function HomeSearchBar() {
  const { resolvedTheme } = useTheme();

  return (
    <Flex
      justify="center"
      align="center"
      direction="column"
      gap="4"
      mt={{ initial: "8rem" }}
    >
      <Box
        pb={"3"}
        width={{ initial: "16rem", md: "20rem", lg: "28rem" }}
        style={{ position: "relative", aspectRatio: "619/103" }}
      >
        <Image
          src={resolvedTheme === "light" ? "/logo-light.svg" : "/logo-dark.svg"}
          alt="seqout"
          fill
          style={{ objectFit: "contain" }}
        />
      </Box>
      <Text
        weight={"medium"}
        color="gray"
        size={{ initial: "1", md: "3" }}
        style={{ userSelect: "none" }}
      >
        Explore sequence datasets
      </Text>
      <HeroSearchBar />
    </Flex>
  );
}
