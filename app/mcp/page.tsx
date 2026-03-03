import SearchBar from "@/components/search-bar";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Box, Callout, Code, Flex, Link, Text } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MCP Server",
  description:
    "Connect Claude Desktop or any MCP client to seqout's remote Model Context Protocol server. Search GEO, SRA, ENA & ArrayExpress datasets from your LLM.",
  alternates: {
    canonical: "https://seqout.org/mcp",
  },
};

export default function MCP() {
  return (
    <>
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction={"column"}
      >
        <Text size={{ initial: "6", md: "8" }} weight="bold" mb="3">
          MCP Server
        </Text>

        <Text size={{ initial: "2", md: "3" }}>
          We offer a remote{" "}
          <Link
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            Model Context Protocol (MCP)
          </Link>{" "}
          server that enables LLM chat clients to use seqout&apos;s features.
          This provides easy and intuitive access to exploring datasets from GEO,
          SRA, ENA & ArrayExpress.
        </Text>

        <Callout.Root>
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text size={{ initial: "2", md: "3" }}>
            Connect your LLM client using this URL:{" "}
            <Code variant="soft" size={{ initial: "1", md: "2" }}>
              https://seqout.org/api/mcp
            </Code>
          </Callout.Text>
        </Callout.Root>

        <Text size={{ initial: "4", md: "6" }} weight="medium">
          Setup Guide for Claude Desktop
        </Text>

        <Flex direction="column" gap="4">
          <Text size={{ initial: "2", md: "3" }}>
            1. Download and install the{" "}
            <Link
              href="https://claude.com/download"
              target="_blank"
              rel="noopener noreferrer"
            >
              Claude Desktop app
            </Link>
          </Text>

          <Text size={{ initial: "2", md: "3" }}>
            2. Open the Claude Desktop configuration file by going to{" "}
            <Text weight="medium">Settings → Developer → Edit Config</Text>
          </Text>

          <Text size={{ initial: "2", md: "3" }}>
            3. Add the following configuration to the <Code>mcpServers</Code>{" "}
            section:
          </Text>

          <Box
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <Code
              variant="soft"
              size={{ initial: "1", md: "2" }}
              style={{
                display: "block",
                whiteSpace: "pre",
                padding: "1rem",
                borderRadius: "8px",
              }}
            >
              {`"mcpServers": {
  "seqout": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://seqout.org/api/mcp"]
  }
}`}
            </Code>
          </Box>

          <Text size={{ initial: "2", md: "3" }}>4. Restart Claude Desktop to apply the changes</Text>

          <Text size={{ initial: "2", md: "3" }}>
            Once configured, you&apos;ll be able to search and explore GEO, SRA,
            ENA & ArrayExpress datasets directly from Claude Desktop conversations.
          </Text>
        </Flex>
      </Flex>
    </>
  );
}
