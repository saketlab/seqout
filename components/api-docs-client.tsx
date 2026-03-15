"use client";

import { copyToClipboard } from "@/utils/clipboard";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Code,
  Flex,
  Tabs,
  Text,
} from "@radix-ui/themes";
import { useState, useCallback, useRef } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopy = useCallback(() => {
    copyToClipboard(text);
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: copied ? "var(--accent-11)" : "var(--gray-9)",
        padding: 4,
      }}
      aria-label="Copy code"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <Box style={{ position: "relative" }}>
      <CopyButton text={code} />
      <Code
        variant="soft"
        size="2"
        style={{
          display: "block",
          whiteSpace: "pre",
          padding: "1rem",
          paddingRight: "2.5rem",
          borderRadius: "8px",
          overflowX: "auto",
        }}
      >
        {code}
      </Code>
    </Box>
  );
}

type Param = {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: string;
  location?: "path" | "query" | "body";
};

type EndpointData = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  params: Param[];
  curl: string;
  python: string;
  r: string;
  responseHint?: string;
  tryUrl?: string;
};

function TryItButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [response, setResponse] = useState<string | null>(null);
  const lastRunRef = useRef(0);

  const handleTry = useCallback(async () => {
    const now = Date.now();
    if (now - lastRunRef.current < 3000) return;
    lastRunRef.current = now;
    setState("loading");
    setResponse(null);
    try {
      const res = await fetch(url);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponse(JSON.stringify(json, null, 2).slice(0, 5000));
      } catch {
        setResponse(text.slice(0, 5000));
      }
      setState("done");
    } catch {
      setState("error");
      setResponse("Request failed");
    }
  }, [url]);

  return (
    <Flex direction="column" gap="2">
      <button
        type="button"
        onClick={handleTry}
        disabled={state === "loading"}
        style={{
          alignSelf: "flex-start",
          padding: "4px 12px",
          borderRadius: 6,
          border: "1px solid var(--accent-8)",
          background: "var(--accent-3)",
          color: "var(--accent-11)",
          cursor: state === "loading" ? "wait" : "pointer",
          fontSize: "var(--font-size-2)",
        }}
      >
        {state === "loading" ? "Running..." : "Try it"}
      </button>
      {response && (
        <Box style={{ position: "relative", maxHeight: 400, overflow: "auto" }}>
          <CopyButton text={response} />
          <Code
            variant="soft"
            size="1"
            style={{
              display: "block",
              whiteSpace: "pre",
              padding: "0.75rem",
              paddingRight: "2.5rem",
              borderRadius: "8px",
              overflowX: "auto",
              color: state === "error" ? "var(--red-11)" : undefined,
            }}
          >
            {response}
          </Code>
        </Box>
      )}
    </Flex>
  );
}

export function EndpointCard({ ep }: { ep: EndpointData }) {
  const [open, setOpen] = useState(false);

  return (
    <Flex
      direction="column"
      style={{
        border: "1px solid var(--gray-5)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Flex
        align="center"
        gap="3"
        p="3"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <Text style={{ color: "var(--gray-9)" }}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Text>
        <Badge
          size="2"
          color={ep.method === "GET" ? "green" : "orange"}
          variant="solid"
          style={{ fontFamily: "monospace", minWidth: 44, textAlign: "center" }}
        >
          {ep.method}
        </Badge>
        <Code size="2" variant="ghost" style={{ color: "var(--gray-12)" }}>
          {ep.path}
        </Code>
        <Text size="2" style={{ color: "var(--gray-10)" }}>
          {ep.summary}
        </Text>
      </Flex>

      {open && (
        <Flex direction="column" gap="3" p="3" pt="0">
          <Text size="2" style={{ color: "var(--gray-11)" }}>
            {ep.description}
          </Text>

          {ep.params.length > 0 && (
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">Parameters</Text>
              <Box
                style={{
                  overflowX: "auto",
                  border: "1px solid var(--gray-4)",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-size-2)" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gray-4)" }}>
                      <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--gray-11)" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--gray-11)" }}>Type</th>
                      <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--gray-11)" }}>Required</th>
                      <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--gray-11)" }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ep.params.map((p) => (
                      <tr key={p.name} style={{ borderBottom: "1px solid var(--gray-3)" }}>
                        <td style={{ padding: "6px 10px" }}>
                          <Code size="1">{p.name}</Code>
                          {p.location === "path" && <Badge size="1" color="gray" ml="1">path</Badge>}
                          {p.location === "body" && <Badge size="1" color="gray" ml="1">body</Badge>}
                        </td>
                        <td style={{ padding: "6px 10px", color: "var(--gray-10)" }}>{p.type}</td>
                        <td style={{ padding: "6px 10px" }}>
                          {p.required ? (
                            <Badge size="1" color="red">required</Badge>
                          ) : (
                            <Text size="1" style={{ color: "var(--gray-9)" }}>
                              {p.default !== undefined ? `default: ${p.default}` : "optional"}
                            </Text>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px", color: "var(--gray-11)" }}>{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            </Flex>
          )}

          {ep.responseHint && (
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">Response</Text>
              <CodeBlock code={ep.responseHint} />
            </Flex>
          )}

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Examples</Text>
            <Tabs.Root defaultValue="curl">
              <Tabs.List>
                <Tabs.Trigger value="curl">curl</Tabs.Trigger>
                <Tabs.Trigger value="python">Python</Tabs.Trigger>
                <Tabs.Trigger value="r">R</Tabs.Trigger>
              </Tabs.List>
              <Box pt="2">
                <Tabs.Content value="curl"><CodeBlock code={ep.curl} /></Tabs.Content>
                <Tabs.Content value="python"><CodeBlock code={ep.python} /></Tabs.Content>
                <Tabs.Content value="r"><CodeBlock code={ep.r} /></Tabs.Content>
              </Box>
            </Tabs.Root>
          </Flex>

          {ep.tryUrl && <TryItButton url={ep.tryUrl} />}
        </Flex>
      )}
    </Flex>
  );
}
