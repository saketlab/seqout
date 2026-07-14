"use client";

import { MagnifyingGlassIcon, Pencil1Icon } from "@radix-ui/react-icons";
import { Flex, Heading, IconButton, Popover, TextField } from "@radix-ui/themes";
import * as React from "react";

type Props = {
  /** Text before the editable value, e.g. "Projects by". */
  label: React.ReactNode;
  value: string;
  placeholder: string;
  /** Accessible name for the edit trigger, e.g. "Edit PMID". */
  editLabel: string;
  /** Only navigate when the typed value is usable. */
  isValid: (next: string) => boolean;
  onSubmit: (next: string) => void;
  inputMode?: React.ComponentProps<"input">["inputMode"];
};

/**
 * A heading whose subject can be re-typed in place — "Projects by <author>",
 * "Projects for PMID <pmid>". Shared by the author and publication pages.
 */
export default function EditableHeading({
  label,
  value,
  placeholder,
  editLabel,
  isValid,
  onSubmit,
  inputMode,
}: Props) {
  const [draft, setDraft] = React.useState(value);
  const [editing, setEditing] = React.useState(false);

  const submit = () => {
    const next = draft.trim();
    setEditing(false);
    if (isValid(next) && next !== value) onSubmit(next);
  };

  return (
    <Heading size="6">
      {label}{" "}
      <Popover.Root
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          if (open) setDraft(value);
        }}
      >
        <Popover.Trigger>
          <button
            type="button"
            aria-label={editLabel}
            style={{
              font: "inherit",
              color: "inherit",
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              fontStyle: "italic",
              textDecoration: "underline",
              textDecorationStyle: "dashed",
              textUnderlineOffset: 4,
              whiteSpace: "nowrap",
            }}
          >
            {value} <Pencil1Icon style={{ verticalAlign: "middle", opacity: 0.7 }} />
          </button>
        </Popover.Trigger>
        <Popover.Content size="1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Flex direction="row" gap="2">
              <TextField.Root
                size="2"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                inputMode={inputMode}
                autoFocus
                aria-label={placeholder}
              />
              <IconButton type="submit">
                <MagnifyingGlassIcon />
              </IconButton>
            </Flex>
          </form>
        </Popover.Content>
      </Popover.Root>
    </Heading>
  );
}
