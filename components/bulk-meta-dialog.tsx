"use client";

import { SERVER_URL } from "@/utils/constants";
import { DownloadIcon, ViewGridIcon } from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  Spinner,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export default function BulkMetaDialog() {
  // dialog control
  const [open, setOpen] = useState(false);

  // textarea input
  const [input, setInput] = useState("");

  // frozen snapshot used to trigger query
  const [submitted, setSubmitted] = useState<string[] | null>(null);

  // fetch ZIP as Blob
  const fetchBulkMetadata = async (accessions: string[]) => {
    const res = await fetch(`${SERVER_URL}/bulk/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessions }),
    });

    if (!res.ok) {
      throw new Error("Download failed");
    }

    return res.blob();
  };

  // react-query (disabled until submit)
  const {
    data: zipBlob,
    isFetching,
  } = useQuery({
    queryKey: ["bulk-metadata", submitted],
    queryFn: () => fetchBulkMetadata(submitted!),
    enabled: submitted !== null,
  });

  // download side-effect
  useEffect(() => {
    if (!zipBlob) return;

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_metadata.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // reset state so user can download again
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitted(null);
    setOpen(false);
  }, [zipBlob]);

  // button click handler
  const handleDownload = () => {
    if (isFetching) return;

    const accs = input
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (accs.length === 0) return;

    setSubmitted(accs);
  };

  const accLines = input
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const hasInvalidAccessions =
    accLines.length > 0 &&
    accLines.some(
      (a) => !/^((GSE|SRP|ERP|DRP|PRJNA)\d+|E-[A-Z]+-\d+)/i.test(a),
    );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button variant="soft">
          <ViewGridIcon /> Get bulk metadata
        </Button>
      </Dialog.Trigger>

      <Dialog.Content size="4">
        <Dialog.Title>Get bulk metadata</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Paste GEO, SRA, ENA, DRA, GEA or ArrayExpress accessions (one
          accession per line)
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`GSE12345\nSRP67890\nGSE111111\nSRP222222`}
            rows={6}
            style={{
              minHeight: 120,
              maxHeight: 300,
              resize: "vertical",
              fontFamily: "monospace",
            }}
          />
        </Flex>
        <Flex mt="4" justify={"between"} align={"center"}>
          {hasInvalidAccessions ? (
            <Text size={"2"} color="red">
              Invalid study or series accessions!
            </Text>
          ) : (
            <div />
          )}

          <Flex gap="3" justify="end" align={"center"}>
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={isFetching}>
                Cancel
              </Button>
            </Dialog.Close>

            <Button
              onClick={handleDownload}
              disabled={isFetching || input.length == 0 || hasInvalidAccessions}
            >
              {isFetching ? <Spinner /> : <DownloadIcon />}
              {isFetching ? "Preparing ZIP..." : "Download"}
            </Button>
          </Flex>
        </Flex>

        {/* {isError && ( */}
        {/* <Flex> */}
        {/* <span style={{ color: "red" }}>Failed to prepare metadata ZIP</span> */}
        {/* </Flex> */}
        {/* )} */}
      </Dialog.Content>
    </Dialog.Root>
  );
}
