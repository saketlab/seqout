"use client";

import { Box, Flex } from "@radix-ui/themes";
import Image from "next/image";
import HeroSearchBar from "./hero-search-bar";

export default function HomeSearchBar() {
  return (
    <Flex
      justify="center"
      align="center"
      direction="column"
      gap="4"
      mt={{ initial: "4rem" }}
    >
      <Box
        pb={"3"}
        width={{ initial: "26rem", md: "20rem", lg: "28rem" }}
        style={{ position: "relative", aspectRatio: "619/103" }}
      >
        <Image
          className="logo-light"
          src="/logo-light.png"
          alt="seqout"
          fill
          sizes="(max-width: 768px) 26rem, (max-width: 1024px) 20rem, 28rem"
          style={{ objectFit: "contain" }}
        />
        <Image
          className="logo-dark"
          src="/logo-dark.png"
          alt="seqout"
          fill
          sizes="(max-width: 768px) 26rem, (max-width: 1024px) 20rem, 28rem"
          style={{ objectFit: "contain" }}
        />
      </Box>

      <HeroSearchBar />
    </Flex>
  );
}
