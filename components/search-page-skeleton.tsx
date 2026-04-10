import { Box, Flex, Separator, Skeleton } from "@radix-ui/themes";

const results = Array.from({ length: 6 }, (_, i) => i);
const filterItems = Array.from({ length: 5 }, (_, i) => i);

export default function SearchPageSkeleton() {
  return (
    <>
      <Flex
        justify={{ initial: "center", md: "between" }}
        align="center"
        p={{ initial: "0", md: "3" }}
        pb={"2"}
        gap={"4"}
        style={{
          position: "sticky",
          top: 0,
          width: "100%",
          zIndex: 50,
          backgroundColor: "var(--color-background)",
          borderBottom: "1px solid var(--gray-a4)",
        }}
      >
        <Flex
          gap={"4"}
          align={"center"}
          flexGrow={"1"}
          direction={{ initial: "column", md: "row" }}
          pt={"2"}
        >
          <Box width={{ initial: "6rem", md: "11rem" }}>
            <Skeleton height={"2rem"} width={"100%"} />
          </Box>
          <Box width={{ initial: "90%", md: "70%" }}>
            <Skeleton height={"2.75rem"} width={"100%"} />
          </Box>
        </Flex>
        <Flex
          gap={"3"}
          align={"center"}
          display={{ initial: "none", md: "flex" }}
        >
          <Skeleton height={"2rem"} width={"2rem"} />
          <Skeleton height={"2rem"} width={"2rem"} />
        </Flex>
      </Flex>

      <Flex
        gap={{ initial: "4", md: "8" }}
        p={"4"}
        justify={"start"}
        direction={{ initial: "column", md: "row" }}
      >
        <Flex
          direction={"row-reverse"}
          justify={"center"}
          gap={"2"}
          display={{ initial: "flex", md: "none" }}
        >
          <Skeleton height={"2rem"} width={"7.5rem"} />
          <Skeleton height={"2rem"} width={"7.5rem"} />
          <Skeleton height={"2rem"} width={"8.5rem"} />
        </Flex>

        <Flex
          direction={"column"}
          gap={"4"}
          display={{ initial: "none", md: "flex" }}
          height={"fit-content"}
          width={"16rem"}
        >
          {filterItems.map((item) => (
            <Skeleton key={`filter-${item}`} height={"1.25rem"} width={"100%"} />
          ))}
          <Separator orientation={"horizontal"} size={"4"} />
          {filterItems.map((item) => (
            <Skeleton
              key={`sort-${item}`}
              height={"1.25rem"}
              width={"100%"}
            />
          ))}
          <Separator orientation={"horizontal"} size={"4"} />
          {filterItems.map((item) => (
            <Skeleton key={`time-${item}`} height={"1.25rem"} width={"100%"} />
          ))}
        </Flex>

        <Flex gap="4" direction="column" width={{ initial: "100%", md: "70%" }}>
          <Skeleton height={"1rem"} width={"18rem"} />
          {results.map((item) => (
            <Skeleton key={`result-${item}`} width={"100%"} height={"6rem"} />
          ))}
          <Flex justify="center" py="4">
            <Skeleton height={"2.25rem"} width={"9rem"} />
          </Flex>
        </Flex>
      </Flex>
    </>
  );
}
